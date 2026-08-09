/**
 * Orthanc → GeraldOS worklist reconciler
 * Primary: Changes API polling with durable cursor.
 * Safe patient matching: MRN exact, no silent merge on name+DOB.
 */
import { db } from "@/db";
import { patients, workflowStudies, systemSettings, reconciliationFailures } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { integrationConfig, orthancAuthHeader, timedFetch } from "@/lib/integrations";
import { recordAudit } from "@/lib/audit";
import { publishEvent } from "@/lib/events";
import { generateAccessionNumber } from "@/lib/utils";

const CURSOR_KEY = "orthanc_reconcile_cursor";
const CURSOR_FALLBACK_REDIS_KEY = "geraldos:reconcile:cursor";

interface OrthancChange {
  Seq: number;
  ChangeType: string;
  ResourceType?: string;
  ID?: string;
  ResourceId?: string;
  Date?: string;
}

interface OrthancStudyExpanded {
  ID: string;
  PatientMainDicomTags?: { PatientName?: string; PatientID?: string; PatientBirthDate?: string; PatientSex?: string };
  MainDicomTags?: {
    StudyInstanceUID?: string;
    StudyDescription?: string;
    AccessionNumber?: string;
    StudyDate?: string;
    ModalitiesInStudy?: string;
  };
  IsStable?: boolean;
}

function parsePatientName(pn?: string): { firstName: string; lastName: string } {
  if (!pn) return { firstName: "Unknown", lastName: "Patient" };
  // DICOM PN: Family^Given^Middle
  const parts = pn.split("^");
  const last = parts[0]?.trim() || "Unknown";
  const first = parts[1]?.trim() || "Unknown";
  return { firstName: first, lastName: last };
}

async function getCursor(): Promise<number> {
  try {
    const rows = await db.select().from(systemSettings).where(eq(systemSettings.key, CURSOR_KEY));
    if (rows.length > 0) {
      const v = rows[0].value as unknown as { cursor?: number };
      if (typeof v?.cursor === "number") return v.cursor;
    }
  } catch {}
  return 0;
}

async function setCursor(cursor: number): Promise<void> {
  try {
    await db
      .insert(systemSettings)
      .values({ key: CURSOR_KEY, value: { cursor } as unknown as never, updatedAt: new Date() })
      .onConflictDoUpdate({ target: systemSettings.key, set: { value: { cursor } as unknown as never, updatedAt: new Date() } });
  } catch (e) {
    console.error("setCursor failed", e);
  }
}

async function findOrCreatePatient(
  patientId: string,
  patientName?: string,
  dob?: string,
  sex?: string,
  studyUidFallback?: string
): Promise<string> {
  const trimmed = patientId?.trim();
  // Strong match: MRN exact
  if (trimmed) {
    const existing = await db.select().from(patients).where(eq(patients.mrn, trimmed)).limit(1);
    if (existing.length > 0) return existing[0].id;
  }
  // Missing/unknown MRN → unresolved identity: deterministic synthetic MRN so same study never creates duplicates
  // but clearly flagged as requiring manual reconciliation (UNRESOLVED prefix)
  if (!trimmed) {
    const synthetic = studyUidFallback
      ? `UNRESOLVED-${studyUidFallback.slice(-16).replace(/[^A-Za-z0-9]/g, "")}`
      : `UNRESOLVED-${Date.now()}`;
    const dup = await db.select().from(patients).where(eq(patients.mrn, synthetic)).limit(1);
    if (dup.length > 0) return dup[0].id;
    const { firstName, lastName } = parsePatientName(patientName);
    const gender = sex === "M" ? "male" : sex === "F" ? "female" : "other";
    const dateOfBirth = dob && /^\d{8}$/.test(dob) ? `${dob.slice(0, 4)}-${dob.slice(4, 6)}-${dob.slice(6, 8)}` : "1970-01-01";
    const [created] = await db
      .insert(patients)
      .values({ mrn: synthetic, firstName, lastName, dateOfBirth, gender, status: "active" })
      .returning();
    await recordAudit({
      userId: "reconciler",
      action: "patient.auto_created",
      module: "reconciliation",
      entityType: "patient",
      entityId: created.id,
      details: { mrn: synthetic, patientName, source: "orthanc_reconcile", unresolved: true, studyUidFallback },
    });
    return created.id;
  }
  // Known MRN but no existing patient → create normally
  const { firstName, lastName } = parsePatientName(patientName);
  const gender = sex === "M" ? "male" : sex === "F" ? "female" : "other";
  const dateOfBirth = dob && /^\d{8}$/.test(dob) ? `${dob.slice(0, 4)}-${dob.slice(4, 6)}-${dob.slice(6, 8)}` : "1970-01-01";
  const [created] = await db.insert(patients).values({ mrn: trimmed, firstName, lastName, dateOfBirth, gender, status: "active" }).returning();
  await recordAudit({
    userId: "reconciler",
    action: "patient.auto_created",
    module: "reconciliation",
    entityType: "patient",
    entityId: created.id,
    details: { mrn: trimmed, patientName, source: "orthanc_reconcile" },
  });
  return created.id;
}

export interface ReconcileResult {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  nextCursor: number;
  cursor: number;
}

export async function reconcileOnce(opts?: { limit?: number }): Promise<ReconcileResult> {
  const { url } = integrationConfig.orthanc;
  if (!url) throw new Error("ORTHANC_URL not configured");
  const limit = opts?.limit ?? 50;
  let cursor = await getCursor();
  const startCursor = cursor;

  let changes: OrthancChange[] = [];
  try {
    const res = await timedFetch(
      `${url.replace(/\/$/, "")}/changes?since=${cursor}&limit=${limit}`,
      { headers: { ...orthancAuthHeader() } },
      8000
    );
    if (!res.ok) throw new Error(`Orthanc /changes HTTP ${res.status}`);
    const data = (await res.json()) as { Changes: OrthancChange[]; Last: number; Done: boolean };
    changes = data.Changes ?? [];
    // If no changes, still advance cursor to Last if provided
    if (changes.length === 0) {
      if (typeof data.Last === "number" && data.Last > cursor) {
        await setCursor(data.Last);
        return { processed: 0, created: 0, updated: 0, skipped: 0, failed: 0, nextCursor: data.Last, cursor: startCursor };
      }
      return { processed: 0, created: 0, updated: 0, skipped: 0, failed: 0, nextCursor: cursor, cursor: startCursor };
    }
  } catch (e) {
    console.error("reconcile: fetch changes failed", e);
    throw e;
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let maxSeq = cursor;

  for (const ch of changes) {
    const seq = ch.Seq ?? 0;
    if (seq > maxSeq) maxSeq = seq;
    // Only process study-level changes
    const isStudyChange =
      ch.ChangeType === "NewStudy" ||
      ch.ChangeType === "StableStudy" ||
      ch.ChangeType === "NewInstance" ||
      ch.ResourceType === "Study";
    if (!isStudyChange && ch.ChangeType !== "StableStudy" && ch.ChangeType !== "NewStudy") {
      // Advance cursor past non-study changes without work
      continue;
    }
    const orthancId = ch.ID || ch.ResourceId;
    if (!orthancId) {
      skipped++;
      continue;
    }
    try {
      // Fetch study expanded
      let study: OrthancStudyExpanded | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await timedFetch(
            `${url.replace(/\/$/, "")}/studies/${orthancId}?expand`,
            { headers: { ...orthancAuthHeader() } },
            6000
          );
          if (r.status === 404) {
            study = null;
            break;
          }
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          study = (await r.json()) as OrthancStudyExpanded;
          break;
        } catch (err) {
          if (attempt === 2) throw err;
          await new Promise((res) => setTimeout(res, 250 * Math.pow(2, attempt)));
        }
      }
      if (!study) {
        skipped++;
        continue;
      }
      // Only promote stable studies to sent_to_orthanc; skip unstable if desired but we still record
      const studyUid = study.MainDicomTags?.StudyInstanceUID;
      if (!studyUid) {
        await db.insert(reconciliationFailures).values({
          orthancChangeId: seq,
          orthancStudyId: orthancId,
          studyInstanceUid: null,
          failureReason: "Missing StudyInstanceUID in Orthanc study",
          payload: study as unknown as never,
        });
        failed++;
        continue;
      }
      const patientIdTag = study.PatientMainDicomTags?.PatientID ?? "";
      const patientName = study.PatientMainDicomTags?.PatientName ?? "";
      const dob = study.PatientMainDicomTags?.PatientBirthDate ?? "";
      const sex = study.PatientMainDicomTags?.PatientSex ?? "";
      const accession = study.MainDicomTags?.AccessionNumber || null;
      const modalityRaw = study.MainDicomTags?.ModalitiesInStudy || "OT";
      const modality = modalityRaw.split("\\")[0].split("/")[0] || "OT";
      const procedure = study.MainDicomTags?.StudyDescription || modality + " Study";

      // Idempotency: check existing by studyInstanceUid
      const existingByUid = await db
        .select()
        .from(workflowStudies)
        .where(eq(workflowStudies.studyInstanceUid, studyUid))
        .limit(1);
      if (existingByUid.length > 0) {
        // Update accession if missing
        if (accession && !existingByUid[0].accessionNumber) {
          await db
            .update(workflowStudies)
            .set({ accessionNumber: accession, updatedAt: new Date() })
            .where(eq(workflowStudies.id, existingByUid[0].id));
        }
        // Ensure stage at least sent_to_orthanc if earlier
        const stageOrder = ["referral", "appointment", "arrival", "study_created", "sent_to_orthanc", "assigned", "opened", "review", "report_draft", "signed", "released", "archived"];
        const curIdx = stageOrder.indexOf(existingByUid[0].stage);
        const targetIdx = stageOrder.indexOf("sent_to_orthanc");
        if (curIdx >= 0 && curIdx < targetIdx) {
          await db
            .update(workflowStudies)
            .set({ stage: "sent_to_orthanc", updatedAt: new Date() })
            .where(eq(workflowStudies.id, existingByUid[0].id));
          await publishEvent({
            type: "study.sent_to_orthanc",
            aggregate: "study",
            aggregateId: existingByUid[0].id,
            payload: { studyInstanceUid: studyUid, orthancStudyId: orthancId, reconciled: true },
            source: "reconciler",
          });
        }
        updated++;
        continue;
      }
      // Accession matching is ONLY safe when it can be corroborated by patient identity.
      // If accession matches but patient MRN differs from workflowStudies.patient, treat as collision → create new study.
      if (accession) {
        const byAcc = await db.select().from(workflowStudies).where(eq(workflowStudies.accessionNumber, accession)).limit(1);
        if (byAcc.length > 0) {
          // Already has a UID and it's different → collision, do not overwrite
          if (byAcc[0].studyInstanceUid && byAcc[0].studyInstanceUid !== studyUid) {
            // Fall through to create path — will insert new study with accession collision handled via generated accession
          } else {
            // Safe to update only if patient matches or accession is the only link
            const linkedPatient = await db.select({ mrn: patients.mrn }).from(patients).where(eq(patients.id, byAcc[0].patientId)).limit(1);
            const accessionPatientMrn = linkedPatient[0]?.mrn ?? null;
            const incomingMrn = patientIdTag?.trim() || null;
            const patientMatches = !incomingMrn || !accessionPatientMrn || incomingMrn === accessionPatientMrn;
            if (patientMatches) {
              await db
                .update(workflowStudies)
                .set({ studyInstanceUid: studyUid, stage: byAcc[0].stage === "referral" || byAcc[0].stage === "study_created" ? "sent_to_orthanc" : byAcc[0].stage, updatedAt: new Date() })
                .where(eq(workflowStudies.id, byAcc[0].id));
              await publishEvent({
                type: "study.sent_to_orthanc",
                aggregate: "study",
                aggregateId: byAcc[0].id,
                payload: { studyInstanceUid: studyUid, orthancStudyId: orthancId, matchedBy: "accession" },
                source: "reconciler",
              });
              updated++;
              continue;
            }
            // Patient mismatch → log collision and fall through to create new study
            await db.insert(reconciliationFailures).values({
              orthancChangeId: seq,
              orthancStudyId: orthancId,
              studyInstanceUid: studyUid,
              failureReason: `Accession collision: ${accession} linked to patient ${accessionPatientMrn} but DICOM PatientID is ${incomingMrn} — created new study`,
              payload: { change: ch, study } as unknown as never,
            });
          }
        }
      }
      // Create new workflow study — find or create patient
      const patientDbId = await findOrCreatePatient(patientIdTag, patientName, dob, sex, studyUid);
      // If accession collides (unique violation due to fallback), generate a fresh one
      let accNum = accession || generateAccessionNumber();
      let createdStudy;
      try {
        const rows = await db
          .insert(workflowStudies)
          .values({
            patientId: patientDbId,
            accessionNumber: accNum,
            studyInstanceUid: studyUid,
            modality,
            procedure,
            stage: "sent_to_orthanc",
            priority: "routine",
          })
          .returning();
        createdStudy = rows[0];
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("accession_number") || msg.includes("unique") || msg.includes("duplicate")) {
          accNum = generateAccessionNumber();
          const rows2 = await db
            .insert(workflowStudies)
            .values({
              patientId: patientDbId,
              accessionNumber: accNum,
              studyInstanceUid: studyUid,
              modality,
              procedure,
              stage: "sent_to_orthanc",
              priority: "routine",
            })
            .returning();
          createdStudy = rows2[0];
        } else throw err;
      }
      if (!createdStudy) throw new Error("Failed to create workflow study");
      await recordAudit({
        userId: "reconciler",
        action: "workflow.reconciled",
        module: "reconciliation",
        entityType: "workflow_study",
        entityId: createdStudy.id,
        details: { studyInstanceUid: studyUid, orthancStudyId: orthancId, modality, patientId: patientDbId },
      });
      await publishEvent({
        type: "study.sent_to_orthanc",
        aggregate: "study",
        aggregateId: createdStudy.id,
        payload: { studyInstanceUid: studyUid, orthancStudyId: orthancId, modality, procedure },
        source: "reconciler",
      });
      await publishEvent({
        type: "worklist.updated",
        aggregate: "workflow",
        aggregateId: createdStudy.id,
        payload: { reason: "reconciled_from_orthanc" },
        source: "reconciler",
      });
      created++;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      try {
        await db.insert(reconciliationFailures).values({
          orthancChangeId: seq,
          orthancStudyId: orthancId ?? null,
          failureReason: reason.slice(0, 2000),
          payload: { change: ch } as unknown as never,
        });
      } catch {}
      console.error(`reconcile: failed for change ${seq} id ${orthancId}`, err);
      failed++;
    }
  }

  await setCursor(maxSeq);
  return { processed: changes.length, created, updated, skipped, failed, nextCursor: maxSeq, cursor: startCursor };
}
