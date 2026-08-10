import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { workflowStudies, patients, staff } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { generateAccessionNumber } from "@/lib/utils";
import { recordAudit } from "@/lib/audit";
import { publishEvent, EVENT_TYPES } from "@/lib/events";
import { stageLabel } from "@/lib/workflow";

export const dynamic = "force-dynamic";

/** GET /api/workflow — all studies with patient/radiologist context + stage label. */
export async function GET() {
  try {
    const result = await db
      .select({
        id: workflowStudies.id,
        accessionNumber: workflowStudies.accessionNumber,
        studyInstanceUid: workflowStudies.studyInstanceUid,
        modality: workflowStudies.modality,
        procedure: workflowStudies.procedure,
        bodyPart: workflowStudies.bodyPart,
        stage: workflowStudies.stage,
        priority: workflowStudies.priority,
        startedAt: workflowStudies.startedAt,
        completedAt: workflowStudies.completedAt,
        createdAt: workflowStudies.createdAt,
        patientId: patients.id,
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
        patientMrn: patients.mrn,
        radiologistId: staff.id,
        radiologistFirstName: staff.firstName,
        radiologistLastName: staff.lastName,
      })
      .from(workflowStudies)
      .leftJoin(patients, eq(workflowStudies.patientId, patients.id))
      .leftJoin(staff, eq(workflowStudies.radiologistId, staff.id))
      .orderBy(desc(workflowStudies.createdAt));

    return NextResponse.json(
      result.map((r) => ({ ...r, stageLabel: stageLabel(r.stage ?? "referral") }))
    );
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch workflow studies" }, { status: 500 });
  }
}

/**
 * POST /api/workflow — create a study at the entry point of the pipeline.
 *
 * A study is born at `referral`. Optionally link an appointment; the study then
 * flows through the state machine exactly like every other study.
 */
export async function POST(request: NextRequest) {
  const { requireRoleOrFail } = await import("@/lib/auth/requireRole");
  const { error: authError } = await requireRoleOrFail(request as unknown as Request, ["radiographer", "radiologist", "administrator", "receptionist"]);
  if (authError) return authError;
  try {
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    if (!body.patientId || !body.modality || !body.procedure) {
      return NextResponse.json(
        { error: "patientId, modality and procedure are required" },
        { status: 400 }
      );
    }

    const [study] = await db
      .insert(workflowStudies)
      .values({
        patientId: body.patientId,
        appointmentId: body.appointmentId ?? null,
        accessionNumber: generateAccessionNumber(),
        modality: body.modality,
        procedure: body.procedure,
        bodyPart: body.bodyPart ?? null,
        stage: "referral",
        priority: body.priority ?? "routine",
      })
      .returning();

    await recordAudit({
      userId: body.changedBy ?? "workflow",
      action: "workflow.created",
      module: "workflow",
      entityType: "workflow_study",
      entityId: study.id,
      details: { procedure: study.procedure, modality: study.modality },
    });
    await publishEvent({
      type: EVENT_TYPES.REFERRAL_RECEIVED,
      aggregate: "study",
      aggregateId: study.id,
      payload: { accessionNumber: study.accessionNumber, procedure: study.procedure, modality: study.modality },
    });
    await publishEvent({
      type: EVENT_TYPES.WORKLIST_UPDATED,
      aggregate: "workflow",
      aggregateId: study.id,
      payload: { reason: "study.created" },
    });

    return NextResponse.json({ ok: true, study }, { status: 201 });
  } catch (error) {
    console.error("workflow create failed", error);
    return NextResponse.json({ error: "Failed to create workflow study" }, { status: 500 });
  }
}
