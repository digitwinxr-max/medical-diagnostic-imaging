import { NextResponse } from "next/server";
import { checkAllIntegrations } from "@/lib/integrations";
import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/system/health — structured health for GeraldOS Clinical Platform
 * Used by /system/health page and ClinicalHealthStrip.
 * Real checks (not config existence): postgres SELECT 1, orthanc /system with auth, ohif /app-config.js, redis PING, etc.
 * Never hard-codes credentials — reads from integrationConfig env.
 */
export async function GET() {
  const start = Date.now();
  // Postgres
  let postgres: { status: "healthy" | "degraded" | "offline" | "not_configured"; latencyMs: number | null; detail?: string };
  const pgStart = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    postgres = { status: "healthy", latencyMs: Date.now() - pgStart, detail: "SELECT 1 ok" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    postgres = { status: "offline", latencyMs: Date.now() - pgStart, detail: msg.slice(0, 300) };
  }

  const integrations = await checkAllIntegrations();
  // Map checkAllIntegrations statuses: connected → healthy, unreachable → offline, not_configured → not_configured
  const mapStatus = (s: string) => (s === "connected" ? "healthy" as const : s === "unreachable" ? "offline" as const : "not_configured" as const);

  const services: Record<string, { status: string; latencyMs: number | null; detail?: string; name?: string }> = {
    postgres: { status: postgres.status, latencyMs: postgres.latencyMs, detail: postgres.detail, name: "PostgreSQL" },
  };

  for (const it of integrations) {
    // keys: orthanc, ohif, keycloak, fhir, dicoogle, n8n, minio, redis, langgraph etc
    const key = it.key === "postgres" ? "postgres" : it.key; // avoid duplicate postgres
    if (key === "postgres") continue;
    services[it.key] = {
      status: mapStatus(it.status),
      latencyMs: it.latencyMs,
      detail: it.detail,
      name: it.name,
    };
  }

  // Normalize expected keys for clinical portal
  const expected = ["postgres", "redis", "orthanc", "ohif", "keycloak", "fhir", "dicoogle", "n8n", "minio", "langgraph"];
  for (const k of expected) if (!services[k]) services[k] = { status: "not_configured", latencyMs: null, name: k };

  // Overall
  const hasOffline = Object.values(services).some((s) => s.status === "offline");
  const hasDegraded = Object.values(services).some((s) => s.status === "not_configured");
  const overall = hasOffline ? "degraded" : hasDegraded ? "degraded" : "healthy";
  // Clinical core must be healthy for workstation
  const clinicalKeys = ["postgres", "orthanc", "ohif", "redis"];
  const clinicalHealthy = clinicalKeys.every((k) => services[k]?.status === "healthy");
  const ctAvailable = services.orthanc?.status === "healthy" ? "check Orthanc studies via /api/orthanc/studies" : "orthanc offline";

  return NextResponse.json(
    {
      status: overall,
      clinicalReady: clinicalHealthy,
      generatedAt: new Date().toISOString(),
      latencyMs: Date.now() - start,
      services,
      ctAvailable,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
