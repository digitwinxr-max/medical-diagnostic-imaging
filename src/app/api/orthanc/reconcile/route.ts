import { NextRequest, NextResponse } from "next/server";
import { reconcileOnce } from "@/lib/orthanc-reconciler";

export const dynamic = "force-dynamic";

/**
 * POST /api/orthanc/reconcile — Run one reconciliation sweep.
 * Body: { limit?: number, cursor?: number }  (cursor override for testing)
 * Also supports GET for manual trigger.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const limit = typeof body.limit === "number" ? Math.min(200, Math.max(1, body.limit)) : 50;
  try {
    const result = await reconcileOnce({ limit });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

export async function GET(request: NextRequest) {
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
  try {
    const result = await reconcileOnce({ limit: Math.min(200, Math.max(1, limit)) });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
