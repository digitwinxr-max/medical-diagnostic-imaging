import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { workflowStudies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { transitionStudy, isWorkflowStage, WORKFLOW_STAGES, stageIndex } from "@/lib/workflow";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/workflow/[id]
 *
 * Real state transitions — no client-side stage juggling:
 *
 *   { action: "transition", to: "review" }        validated forward move
 *   { stage: "sent_to_orthanc", studyInstanceUid: "1.2.3..." }   (legacy alias)
 *   { action: "assign", radiologistId: "<staff-id>" }   assigns + moves to `assigned`
 *   { priority: "stat" }                          plain field update (no stage change)
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { requireRoleOrFail } = await import("@/lib/auth/requireRole");
  const { error: authError } = await requireRoleOrFail(request as unknown as Request, ["radiographer", "radiologist", "administrator"]);
  if (authError) return authError;
try {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }

    const [study] = await db.select().from(workflowStudies).where(eq(workflowStudies.id, id));
    if (!study) return NextResponse.json({ error: "Study not found" }, { status: 404 });

    const changedBy = body.changedBy ?? "workflow";

    // ── Assignment / re-assignment action ──
    if (body.action === "assign") {
      const radiologistId = body.radiologistId ?? null;
      if (!radiologistId) {
        return NextResponse.json({ error: "radiologistId is required to assign a study" }, { status: 400 });
      }
      // Re-assignment (study already past `assigned`) updates the radiologist
      // without rolling the study backwards; otherwise it enters the pipeline.
      if (stageIndex(study.stage) > stageIndex("assigned")) {
        const [updated] = await db
          .update(workflowStudies)
          .set({ radiologistId, updatedAt: new Date() })
          .where(eq(workflowStudies.id, id))
          .returning();
        await recordAudit({
          userId: changedBy,
          action: "workflow.reassigned",
          module: "workflow",
          entityType: "workflow_study",
          entityId: id,
          details: { radiologistId },
        });
        return NextResponse.json({ ok: true, study: updated, transitioned: false, reassigned: true });
      }
      const result = await transitionStudy({ studyId: id, to: "assigned", radiologistId, changedBy });
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
      return NextResponse.json({ ok: true, study: result.study, transitioned: result.transitioned, fromStage: result.fromStage, toStage: result.toStage });
    }

    // ── Stage transitions ──
    const target = body.action === "transition" ? body.to : body.stage;
    if (target !== undefined) {
      if (typeof target !== "string" || !isWorkflowStage(target)) {
        return NextResponse.json(
          { error: `invalid stage "${String(target)}" — expected one of ${WORKFLOW_STAGES.map((s) => s.key).join(", ")}` },
          { status: 400 }
        );
      }
      const result = await transitionStudy({
        studyId: id,
        to: target,
        changedBy,
        studyInstanceUid: body.studyInstanceUid ?? null,
        radiologistId: body.radiologistId ?? null,
      });
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
      return NextResponse.json({ ok: true, study: result.study, transitioned: result.transitioned, fromStage: result.fromStage, toStage: result.toStage });
    }

    // ── Plain field updates (priority, radiologistId, studyInstanceUid, notes…) ──
    const allowedFields: (keyof typeof workflowStudies.$inferSelect)[] = [
      "priority", "radiologistId", "studyInstanceUid", "bodyPart", "procedure", "modality",
    ];
    const updates: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) updates[field] = body[field];
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "no supported fields provided" }, { status: 400 });
    }
    updates.updatedAt = new Date();
    const [updated] = await db.update(workflowStudies).set(updates).where(eq(workflowStudies.id, id)).returning();
    await recordAudit({
      userId: changedBy,
      action: "workflow.updated",
      module: "workflow",
      entityType: "workflow_study",
      entityId: id,
      details: { updates },
    });
    return NextResponse.json({ ok: true, study: updated, transitioned: false });
  } catch (error) {
    console.error("workflow PATCH failed", error);
    return NextResponse.json({ error: "Failed to update study" }, { status: 500 });
  }
}
