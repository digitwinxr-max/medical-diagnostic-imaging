import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { workflowStudies, patients, staff, appointments, referrals, equipment } from "@/db/schema";
import { eq, desc, ilike, and, or, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/worklist — enterprise radiology worklist.
 *
 * Each entry carries the clinical context needed to drive the workstation:
 * patient, procedure, priority, stage, radiologist, machine (equipment),
 * referring physician, scheduled slot and PACS link.
 *
 * Query params (all optional, combinable):
 *   view        today | unread | stat | emergency | assigned | completed | all
 *   q           free-text search (patient name / MRN / accession)
 *   modality    CT | X-Ray | MRI | Ultrasound | ...
 *   radiologist free-text name match
 *   machine     equipment name match
 *   physician   referring physician name match
 *   location    equipment location match
 *   priority    stat | urgent | routine
 *   stage       referral | scheduled | started | review | completed | released | archived
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const view = sp.get("view") ?? "all";
  const q = (sp.get("q") ?? "").trim().toLowerCase();
  const modality = sp.get("modality");
  const radiologist = (sp.get("radiologist") ?? "").trim().toLowerCase();
  const machine = (sp.get("machine") ?? "").trim().toLowerCase();
  const physician = (sp.get("physician") ?? "").trim().toLowerCase();
  const location = (sp.get("location") ?? "").trim().toLowerCase();
  const priority = sp.get("priority");
  const stage = sp.get("stage");

  const today = new Date().toISOString().split("T")[0];

  const conditions = [];
  if (view === "today") conditions.push(sql`${workflowStudies.createdAt}::date = ${today}::date`);
  if (view === "unread") conditions.push(eq(workflowStudies.stage, "referral"));
  if (view === "stat") conditions.push(sql`lower(${workflowStudies.priority}) = 'stat'`);
  if (view === "emergency") conditions.push(sql`lower(${workflowStudies.priority}) = 'emergency'`);
  if (view === "assigned") conditions.push(sql`${workflowStudies.radiologistId} IS NOT NULL`);
  if (view === "completed") conditions.push(sql`${workflowStudies.stage} IN ('completed','released','archived')`);
  if (modality) conditions.push(sql`lower(${workflowStudies.modality}) = ${modality.toLowerCase()}`);
  if (priority) conditions.push(sql`lower(${workflowStudies.priority}) = ${priority.toLowerCase()}`);
  if (stage) conditions.push(sql`lower(${workflowStudies.stage}) = ${stage.toLowerCase()}`);
  if (q) {
    conditions.push(
      or(
        ilike(patients.firstName, `%${q}%`),
        ilike(patients.lastName, `%${q}%`),
        ilike(patients.mrn, `%${q}%`),
        ilike(workflowStudies.accessionNumber, `%${q}%`)
      )
    );
  }
  if (radiologist) conditions.push(or(ilike(staff.firstName, `%${radiologist}%`), ilike(staff.lastName, `%${radiologist}%`)));
  if (machine) conditions.push(ilike(equipment.name, `%${machine}%`));
  if (physician) conditions.push(ilike(referrals.referringPhysician, `%${physician}%`));
  if (location) conditions.push(ilike(equipment.location, `%${location}%`));

  try {
    const rows = await db
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
        patientDob: patients.dateOfBirth,
        patientGender: patients.gender,
        radiologistId: staff.id,
        radiologistFirstName: staff.firstName,
        radiologistLastName: staff.lastName,
        machineId: equipment.id,
        machineName: equipment.name,
        machineModality: equipment.modality,
        machineLocation: equipment.location,
        referringPhysician: referrals.referringPhysician,
        referringFacility: referrals.referringFacility,
        clinicalIndication: referrals.clinicalIndication,
        scheduledDate: appointments.scheduledDate,
        scheduledTime: appointments.scheduledTime,
      })
      .from(workflowStudies)
      .leftJoin(patients, eq(workflowStudies.patientId, patients.id))
      .leftJoin(staff, eq(workflowStudies.radiologistId, staff.id))
      .leftJoin(appointments, eq(workflowStudies.appointmentId, appointments.id))
      .leftJoin(referrals, eq(appointments.referralId, referrals.id))
      .leftJoin(equipment, eq(appointments.equipmentId, equipment.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(workflowStudies.createdAt));

    // Priority sort: emergency > stat > urgent > routine
    const rank: Record<string, number> = { emergency: 0, stat: 1, urgent: 2, routine: 3, undefined: 4 };
    rows.sort((a, b) => (rank[a.priority ?? "undefined"] ?? 4) - (rank[b.priority ?? "undefined"] ?? 4));

    return NextResponse.json({ ok: true, entries: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "failed to load worklist", detail: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

