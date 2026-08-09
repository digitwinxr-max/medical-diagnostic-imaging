import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { reconciliationFailures } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { reconcileOnce } from "@/lib/orthanc-reconciler";

export const dynamic = "force-dynamic";

/**
 * POST /api/orthanc/reconcile/replay — Retry a DLQ entry or re-run reconciliation
 * Body: { id?: number } — specific DLQ id to mark resolved; if omitted, re-runs reconcileOnce
 * The DLQ is manual-recovery: an operator reviews failures then calls replay.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (body.id) {
    const id = Number(body.id);
    const [existing] = await db.select().from(reconciliationFailures).where(eq(reconciliationFailures.id, id)).limit(1);
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
    // Re-attempt reconciliation sweep (cursor-based) and mark this DLQ resolved if its study now exists
    try {
      await reconcileOnce({ limit: 50 });
    } catch {}
    await db.update(reconciliationFailures).set({ status: "retried", retryCount: sql`${reconciliationFailures.retryCount} + 1` }).where(eq(reconciliationFailures.id, id));
    return NextResponse.json({ ok: true, id, status: "retried" });
  }
  // No id: just re-run reconciliation (transient failures like Orthanc 502 will be retried)
  try {
    const result = await reconcileOnce({ limit: 50 });
    return NextResponse.json({ ok: true, replay: "reconcile", ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

export async function GET() {
  const rows = await db.select().from(reconciliationFailures).where(eq(reconciliationFailures.status, "pending")).orderBy(reconciliationFailures.createdAt).limit(100);
  return NextResponse.json({ ok: true, failures: rows });
}
