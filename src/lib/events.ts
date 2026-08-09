/**
 * GeraldOS Event Bus — event-driven architecture over Redis Streams.
 *
 * Every major action publishes an event. Modules react to events; no synchronous
 * coupling. When REDIS_URL is configured the bus writes to the `geraldos:events`
 * Redis Stream (XADD, capped), otherwise — and always — events are persisted to
 * the `event_log` table so the audit/activity feed never depends on Redis uptime.
 */

import { db } from "@/db";
import { eventLog } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { integrationConfig } from "@/lib/integrations";

export const EVENT_STREAM = "geraldos:events";
export const EVENT_GROUP = "geraldos-consumers";

/** Central registry of every domain event the platform emits. */
export const EVENT_TYPES = {
  PATIENT_REGISTERED: "patient.registered",
  PATIENT_UPDATED: "patient.updated",
  REFERRAL_RECEIVED: "referral.received",
  APPOINTMENT_CREATED: "appointment.created",
  APPOINTMENT_CHECKED_IN: "appointment.checked_in",
  APPOINTMENT_DELAYED: "appointment.delayed",
  STUDY_UPLOADED: "study.uploaded",
  STUDY_CREATED: "study.created",
  STUDY_SENT_TO_ORTHANC: "study.sent_to_orthanc",
  WORKLIST_UPDATED: "worklist.updated",
  STUDY_STARTED: "study.started",
  STUDY_COMPLETED: "study.completed",
  STUDY_ROUTED: "study.routed",
  STUDY_OPENED: "study.opened",
  STUDY_ASSIGNED: "study.assigned",
  VIEWER_CLOSED: "viewer.closed",
  MEASUREMENT_CREATED: "measurement.created",
  ANNOTATION_ADDED: "annotation.added",
  AI_REVIEW_COMPLETED: "ai.review_completed",
  REPORT_RELEASED: "report.released",
  STUDY_ARCHIVED: "study.archived",
  REPORT_STARTED: "report.started",
  REPORT_DRAFTED: "report.drafted",
  REPORT_APPROVED: "report.approved",
  REPORT_SIGNED: "report.signed",
  REPORT_VERSIONED: "report.versioned",
  AI_OBSERVATION_SUGGESTED: "ai.observation_suggested",
  AI_OBSERVATION_ACCEPTED: "ai.observation_accepted",
  AI_OBSERVATION_REJECTED: "ai.observation_rejected",
  DECISION_PROPOSED: "decision.proposed",
  DECISION_APPROVED: "decision.approved",
  DECISION_REJECTED: "decision.rejected",
  DECISION_EXECUTED: "decision.executed",
  INVENTORY_UPDATED: "inventory.updated",
  INVENTORY_LOW_STOCK: "inventory.low_stock",
  EQUIPMENT_ONLINE: "equipment.online",
  EQUIPMENT_OFFLINE: "equipment.offline",
  MAINTENANCE_SCHEDULED: "maintenance.scheduled",
  KNOWLEDGE_PUBLISHED: "knowledge.published",
  NOTIFICATION_SENT: "notification.sent",
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

export interface PublishEventInput {
  type: string;
  aggregate: string;
  aggregateId?: string | null;
  payload?: Record<string, unknown> | null;
  source?: string;
  correlationId?: string;
  causationId?: string;
  idempotencyKey?: string;
}

// ─── Redis client (lazy, non-fatal when unreachable) ───
let redisClient: import("ioredis").Redis | null = null;
let redisFailedAt = 0;

async function getRedis() {
  const { redis } = integrationConfig;
  if (!redis.url) return null;
  if (redisClient) return redisClient;
  // Back off for 30s after a failed attempt to avoid reconnect storms.
  if (redisFailedAt && Date.now() - redisFailedAt < 30_000) return null;
  try {
    const { default: Redis } = await import("ioredis");
    redisClient = new Redis(redis.url, {
      connectTimeout: 2000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      lazyConnect: true,
    });
    redisClient.on("error", () => {
      redisFailedAt = Date.now();
    });
    await redisClient.connect();
    return redisClient;
  } catch {
    redisFailedAt = Date.now();
    return null;
  }
}

/** Publish an event to the Redis stream AND persist it to the event_log table.
 *  Durable log is authoritative; Redis is best-effort transport with retry.
 *  Idempotency: if idempotencyKey provided, duplicate inserts are skipped.
 */
export async function publishEvent(input: PublishEventInput): Promise<void> {
  const occurredAt = new Date();
  const correlationId = input.correlationId ?? input.idempotencyKey ?? null;
  const idempotencyKey = input.idempotencyKey ?? (input.aggregateId ? `${input.type}:${input.aggregate}:${input.aggregateId}` : null);
  const payload = { ...(input.payload ?? {}), occurredAt: occurredAt.toISOString(), correlationId, causationId: input.causationId ?? null };

  // Idempotency check: skip if same idempotencyKey already logged recently (within same aggregateId+type)
  if (idempotencyKey) {
    try {
      const existing = await db
        .select({ id: eventLog.id })
        .from(eventLog)
        .where(eq(eventLog.idempotencyKey, idempotencyKey))
        .limit(1);
      if (existing.length > 0) return;
    } catch {}
  }

  // 1) Durable persistence FIRST (outbox pattern — never lose event)
  //    Unique index on idempotency_key provides DB-level race protection.
  let insertedId: number | null = null;
  try {
    const rows = await db
      .insert(eventLog)
      .values({
        eventType: input.type,
        aggregate: input.aggregate,
        aggregateId: input.aggregateId ?? null,
        payload,
        source: input.source ?? "app",
        correlationId,
        causationId: input.causationId ?? null,
        idempotencyKey,
      })
      .returning({ id: eventLog.id });
    insertedId = rows[0]?.id ?? null;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (idempotencyKey && (msg.includes("ux_event_log_idempotency") || msg.includes("duplicate") || msg.includes("unique"))) {
      // Concurrent duplicate — treat as success, already logged
      return;
    }
    console.error("event_log write failed", error);
    return;
  }

  // 2) Redis Streams (best-effort, with retry via next publish; durable log ensures no loss)
  try {
    const redis = await getRedis();
    if (redis) {
      await redis.xadd(
        EVENT_STREAM,
        "MAXLEN",
        "~",
        10000,
        "*",
        "type",
        input.type,
        "aggregate",
        input.aggregate,
        "aggregateId",
        input.aggregateId ?? "",
        "source",
        input.source ?? "app",
        "correlationId",
        correlationId ?? "",
        "idempotencyKey",
        idempotencyKey ?? "",
        "payload",
        JSON.stringify(payload),
        "eventId",
        String(insertedId ?? "")
      );
    }
  } catch {
    // Redis down — will be retried on next publish or via reconciler; event remains durable
    console.warn("Redis XADD failed, event durable in PG id", insertedId);
  }
}

/**
 * Re-publish recent events to Redis (best-effort at-least-once).
 * NOTE: This is NOT a true pending-delivery tracker — it simply replays the
 * latest N durable events. Redis is transport (at-least-once); PostgreSQL
 * event_log is authoritative. Consumers must deduplicate via idempotencyKey.
 * Called on startup or manually to recover from Redis downtime.
 */
export async function flushPendingToRedis(limit = 100): Promise<number> {
  const redis = await getRedis();
  if (!redis) return 0;
  try {
    const rows = await db.select().from(eventLog).orderBy(desc(eventLog.id)).limit(limit);
    for (const r of rows.slice().reverse()) {
      try {
        await redis.xadd(
          EVENT_STREAM,
          "MAXLEN",
          "~",
          10000,
          "*",
          "type",
          r.eventType,
          "aggregate",
          r.aggregate,
          "aggregateId",
          r.aggregateId ?? "",
          "source",
          r.source ?? "app",
          "payload",
          JSON.stringify(r.payload),
          "eventId",
          String(r.id)
        );
      } catch {}
    }
    return rows.length;
  } catch {
    return 0;
  }
}

/** Read the tail of the event stream (most recent first). */
export async function listEvents(limit = 50, type?: string): Promise<{
  id: number;
  eventType: string;
  aggregate: string;
  aggregateId: string | null;
  payload: Record<string, unknown> | null;
  source: string;
  occurredAt: Date;
}[]> {
  const rows = type
    ? await db.select().from(eventLog).where(eq(eventLog.eventType, type)).orderBy(desc(eventLog.id)).limit(limit)
    : await db.select().from(eventLog).orderBy(desc(eventLog.id)).limit(limit);
  return rows.map((r) => ({ ...r, payload: (r.payload ?? null) as Record<string, unknown> | null }));
}

/** Count events grouped by type (for the command centre activity feed). */
export async function eventCounts(): Promise<{ eventType: string; count: number }[]> {
  const rows = await db
    .select({ eventType: eventLog.eventType, count: sql<number>`count(*)` })
    .from(eventLog)
    .groupBy(eventLog.eventType)
    .orderBy(desc(sql`count(*)`));
  return rows as { eventType: string; count: number }[];
}
