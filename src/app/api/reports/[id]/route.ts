import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { reports, reportVersions, patients, staff } from "@/db/schema";
import { eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { publishEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

/** GET /api/reports/[id] — full report with patient + radiologist context. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [row] = await db
    .select({
      id: reports.id,
      studyId: reports.studyId,
      templateName: reports.templateName,
      findings: reports.findings,
      impression: reports.impression,
      recommendation: reports.recommendation,
      status: reports.status,
      signedAt: reports.signedAt,
      createdAt: reports.createdAt,
      updatedAt: reports.updatedAt,
      patientId: patients.id,
      patientFirstName: patients.firstName,
      patientLastName: patients.lastName,
      patientMrn: patients.mrn,
      radiologistFirstName: staff.firstName,
      radiologistLastName: staff.lastName,
    })
    .from(reports)
    .leftJoin(patients, eq(reports.patientId, patients.id))
    .leftJoin(staff, eq(reports.radiologistId, staff.id))
    .where(eq(reports.id, id));
  if (!row) return NextResponse.json({ error: "report not found" }, { status: 404 });
  return NextResponse.json({ ok: true, report: row }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * PATCH /api/reports/[id]
 *
 * Updates draft fields and snapshots the previous version into report_versions.
 * Moving a report to `signed` requires an explicit `approvedBy` (the radiologist's
 * confirmation) — the platform never finalises a report automatically.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const { requireRoleOrFail: requireReportRole } = await import("@/lib/auth/requireRole");
  const { error: reportAuthError } = await requireReportRole(request as unknown as Request, ["radiologist", "administrator"]);
  if (reportAuthError) return reportAuthError;
  const [existing] = await db.select().from(reports).where(eq(reports.id, id));
  if (!existing) return NextResponse.json({ error: "report not found" }, { status: 404 });

  // Guard: no auto-finalise.
  if (body.status === "signed" && !body.approvedBy) {
    return NextResponse.json(
      { error: "reports can only be signed with explicit radiologist confirmation (approvedBy)" },
      { status: 400 }
    );
  }
  // Guard: only radiologists sign. In production, empty roles never passes.
  if (body.status === "signed") {
    const { verifySessionToken } = await import("@/lib/auth/session");
    const { isRadiologist } = await import("@/lib/auth/requireRole");
    const isProd = process.env.NODE_ENV === "production" || process.env.GERALDOS_ENV === "production";
    const cookie = request.cookies.get("geraldos_session")?.value;
    const user = cookie ? await verifySessionToken(cookie) : null;
    // In production, unauthenticated or empty roles fails closed
    if (isProd && !user) {
      return NextResponse.json({ error: "authentication required to sign" }, { status: 401 });
    }
    const allowed = isRadiologist(user);
    // In non-prod, allow empty roles for dev demo only when not in prod
    const devAllow = !isProd && (!user || (user.roles.length === 0));
    if (!allowed && !devAllow) {
      return NextResponse.json({ error: "signing requires the radiologist role" }, { status: 403 });
    }
  }

  const statusChanged = body.status && body.status !== existing.status;

  // Snapshot the current version before mutating.
  if (existing.findings || existing.impression || existing.recommendation) {
    const prev = await db
      .select({ version: reportVersions.version })
      .from(reportVersions)
      .where(eq(reportVersions.reportId, id))
      .orderBy(reportVersions.version);
    const nextVersion = (prev.at(-1)?.version ?? 0) + 1;
    await db.insert(reportVersions).values({
      reportId: id,
      version: nextVersion,
      findings: existing.findings,
      impression: existing.impression,
      recommendation: existing.recommendation,
      status: existing.status,
      qualityScore: body.qualityScore ?? null,
      aiAssisted: body.aiAssisted ?? false,
      changedBy: body.changedBy ?? "radiologist",
    });
    await publishEvent({ type: "report.versioned", aggregate: "report", aggregateId: id, payload: { version: nextVersion } });
  }

  const updates: Record<string, unknown> = {};
  if (body.findings !== undefined) updates.findings = body.findings;
  if (body.impression !== undefined) updates.impression = body.impression;
  if (body.recommendation !== undefined) updates.recommendation = body.recommendation;
  if (body.templateName !== undefined) updates.templateName = body.templateName;
  if (body.status) updates.status = body.status;
  if (body.status === "signed") updates.signedAt = new Date();
  updates.updatedAt = new Date();

  const [updated] = await db.update(reports).set(updates).where(eq(reports.id, id)).returning();

  await recordAudit({
    userId: body.changedBy ?? "radiologist",
    action: statusChanged ? `report.${updated.status}` : "report.updated",
    module: "reporting",
    entityType: "report",
    entityId: id,
    details: { status: updated.status, signedBy: body.approvedBy },
  });
  if (statusChanged && updated.status === "signed") {
    await publishEvent({ type: "report.signed", aggregate: "report", aggregateId: id, payload: { approvedBy: body.approvedBy } });
  } else if (statusChanged) {
    await publishEvent({ type: "report.drafted", aggregate: "report", aggregateId: id, payload: { status: updated.status } });
  }

  return NextResponse.json({ ok: true, report: updated }, { headers: { "Cache-Control": "no-store" } });
}
