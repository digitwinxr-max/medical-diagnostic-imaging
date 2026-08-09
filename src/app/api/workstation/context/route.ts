import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { patients, referrals, reports, workflowStudies, knowledgeDocuments, aiObservations } from "@/db/schema";
import { eq, desc, ilike, and, sql } from "drizzle-orm";
import { integrationConfig, orthancAuthHeader, timedFetch } from "@/lib/integrations";

export const dynamic = "force-dynamic";

interface OrthancStudyResource {
  ID: string;
  PatientMainDicomTags?: { PatientName?: string; PatientID?: string };
  MainDicomTags?: {
    StudyInstanceUID?: string;
    StudyDescription?: string;
    StudyDate?: string;
    AccessionNumber?: string;
    ModalitiesInStudy?: string;
  };
  Series?: string[];
}

/**
 * GET /api/workstation/context?orthancStudyId=…&studyId=…&patientId=…&modality=…
 *
 * Phase 6 Case Intelligence — everything the radiologist needs to interpret a
 * study without leaving the workstation:
 *   - patient demographics + clinical history (from Orthanc / RIS)
 *   - previous examinations (Orthanc patient timeline + RIS workflow history)
 *   - previous reports (signed reports for the same patient)
 *   - referral information (indication, referring physician, facility)
 *   - relevant protocols & teaching files (approved knowledge docs)
 *   - similar historical cases (accepted AI observations with matching features)
 * Every source degrades gracefully when not configured.
 */
export async function GET(request: NextRequest) {
  const orthancStudyId = request.nextUrl.searchParams.get("orthancStudyId");
  const studyId = request.nextUrl.searchParams.get("studyId");
  const patientIdParam = request.nextUrl.searchParams.get("patientId");
  const modality = request.nextUrl.searchParams.get("modality");

  const out: {
    patient: Record<string, unknown> | null;
    history: string | null;
    referral: Record<string, unknown> | null;
    previousStudies: Record<string, unknown>[];
    previousReports: Record<string, unknown>[];
    protocols: Record<string, unknown>[];
    similarCases: Record<string, unknown>[];
    teachingFiles: Record<string, unknown>[];
    fhirLabSummary: string | null;
  } = {
    patient: null,
    history: null,
    referral: null,
    previousStudies: [],
    previousReports: [],
    protocols: [],
    similarCases: [],
    teachingFiles: [],
    fhirLabSummary: null,
  };

  // ── Resolve patient identity ──
  let patientMrn: string | null = null;
  let patientId: string | null = patientIdParam ?? null;
  let orthancPatientId: string | null = null;

  if (orthancStudyId && integrationConfig.orthanc.url) {
    try {
      const res = await timedFetch(
        `${integrationConfig.orthanc.url.replace(/\/$/, "")}/studies/${orthancStudyId}?expand`,
        { headers: { ...orthancAuthHeader() } },
        8000
      );
      if (res.ok) {
        const study = (await res.json()) as {
          PatientMainDicomTags?: { PatientName?: string; PatientID?: string; PatientBirthDate?: string; PatientSex?: string };
          MainDicomTags?: { StudyDescription?: string; StudyDate?: string; ModalitiesInStudy?: string; ReferringPhysicianName?: string };
          ParentPatient?: string;
          PatientID?: string;
        };
        orthancPatientId = (study as { ParentPatient?: string }).ParentPatient ?? null;
        patientMrn = study.PatientMainDicomTags?.PatientID ?? null;
        out.patient = {
          name: study.PatientMainDicomTags?.PatientName ?? "Unknown Patient",
          mrn: patientMrn,
          birthDate: study.PatientMainDicomTags?.PatientBirthDate ?? null,
          sex: study.PatientMainDicomTags?.PatientSex ?? null,
          studyDescription: study.MainDicomTags?.StudyDescription ?? null,
          studyDate: study.MainDicomTags?.StudyDate ?? null,
          modalities: study.MainDicomTags?.ModalitiesInStudy ?? null,
          referringPhysician: study.MainDicomTags?.ReferringPhysicianName ?? null,
        };
      }
    } catch {
      // Orthanc unreachable — RIS data below still loads.
    }
  }

  // RIS patient record (by id or mrn).
  if (patientId || patientMrn) {
    const cond = patientId ? eq(patients.id, patientId) : ilike(patients.mrn, `%${patientMrn}%`);
    const [pat] = await db
      .select()
      .from(patients)
      .where(cond)
      .limit(1);
    if (pat) {
      patientId = pat.id;
      patientMrn = pat.mrn;
      out.patient = {
        ...(out.patient ?? {}),
        id: pat.id,
        name: `${pat.firstName} ${pat.lastName}`,
        mrn: pat.mrn,
        dob: pat.dateOfBirth,
        gender: pat.gender,
        phone: pat.phone,
        email: pat.email,
        insuranceProvider: pat.insuranceProvider,
        insurancePolicyNumber: pat.insurancePolicyNumber,
      };
      out.history = [
        pat.emergencyContactName ? `Emergency contact: ${pat.emergencyContactName}` : null,
        pat.insuranceProvider ? `Insurance: ${pat.insuranceProvider}${pat.insurancePolicyNumber ? ` (${pat.insurancePolicyNumber})` : ""}` : null,
        `Consent: ${pat.consentSigned ? "signed" : "not signed"}`,
      ]
        .filter(Boolean)
        .join("\n");
    }
  }

  // ── Referral information ──
  if (patientId) {
    const [ref] = await db
      .select()
      .from(referrals)
      .where(eq(referrals.patientId, patientId))
      .orderBy(desc(referrals.createdAt))
      .limit(1);
    if (ref) {
      out.referral = {
        referringPhysician: ref.referringPhysician,
        referringFacility: ref.referringFacility,
        clinicalIndication: ref.clinicalIndication,
        requestedProcedure: ref.requestedProcedure,
        priority: ref.priority,
        notes: ref.notes,
      };
    }
  }

  // ── Previous studies: Orthanc patient timeline ──
  if (orthancPatientId && integrationConfig.orthanc.url) {
    try {
      const res = await timedFetch(
        `${integrationConfig.orthanc.url.replace(/\/$/, "")}/patients/${orthancPatientId}/studies`,
        { headers: { ...orthancAuthHeader() } },
        8000
      );
      if (res.ok) {
        const ids = (await res.json()) as string[];
        const detail = await Promise.all(
          ids.slice(0, 12).map(async (id) => {
            const r = await timedFetch(
              `${integrationConfig.orthanc.url.replace(/\/$/, "")}/studies/${id}?expand`,
              { headers: { ...orthancAuthHeader() } },
              6000
            );
            if (!r.ok) return null;
            const s = (await r.json()) as OrthancStudyResource;
            return {
              orthancId: s.ID,
              studyInstanceUid: s.MainDicomTags?.StudyInstanceUID ?? null,
              description: s.MainDicomTags?.StudyDescription ?? null,
              studyDate: s.MainDicomTags?.StudyDate ?? null,
              modalities: s.MainDicomTags?.ModalitiesInStudy ?? "—",
              seriesCount: s.Series?.length ?? 0,
            };
          })
        );
        out.previousStudies = (detail.filter((s): s is NonNullable<typeof s> => s !== null && s.orthancId !== orthancStudyId)) as Record<string, unknown>[];
      }
    } catch {
      // fall through to RIS history
    }
  }

  // Previous studies from RIS (same patient, excluding current).
  if (patientId) {
    const risHistory = await db
      .select({
        id: workflowStudies.id,
        accessionNumber: workflowStudies.accessionNumber,
        studyInstanceUid: workflowStudies.studyInstanceUid,
        modality: workflowStudies.modality,
        procedure: workflowStudies.procedure,
        stage: workflowStudies.stage,
        createdAt: workflowStudies.createdAt,
      })
      .from(workflowStudies)
      .where(and(eq(workflowStudies.patientId, patientId), studyId ? sql`${workflowStudies.id} != ${studyId}` : sql`true`))
      .orderBy(desc(workflowStudies.createdAt))
      .limit(20);
    out.previousStudies = [...out.previousStudies, ...risHistory.map((s) => ({ ...s, source: "ris" }))];
  }

  // ── Previous reports for the patient ──
  if (patientId) {
    const prevReports = await db
      .select({
        id: reports.id,
        templateName: reports.templateName,
        findings: reports.findings,
        impression: reports.impression,
        recommendation: reports.recommendation,
        status: reports.status,
        signedAt: reports.signedAt,
        createdAt: reports.createdAt,
      })
      .from(reports)
      .where(eq(reports.patientId, patientId))
      .orderBy(desc(reports.createdAt))
      .limit(10);
    out.previousReports = prevReports.filter((r) => (r.status === "signed" || r.status === "released") && (r.impression || r.findings));
  }

  // ── Relevant protocols & teaching files (approved knowledge) ──
  try {
    const docs = await db
      .select({
        id: knowledgeDocuments.id,
        title: knowledgeDocuments.title,
        category: knowledgeDocuments.category,
        docType: knowledgeDocuments.docType,
        summary: knowledgeDocuments.summary,
        version: knowledgeDocuments.version,
      })
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.status, "published"))
      .limit(50);
    const q = `${modality ?? ""} ${out.patient?.studyDescription ?? ""}`.toLowerCase();
    const scored = docs
      .map((d) => {
        const hay = `${d.title} ${d.summary ?? ""} ${d.category}`.toLowerCase();
        let score = 0;
        for (const tok of q.split(/[\s/]+/).filter((t) => t.length > 2)) {
          if (hay.includes(tok)) score += 1;
        }
        return { ...d, score };
      })
      .sort((a, b) => b.score - a.score);
    out.protocols = scored.filter((d) => d.category === "protocol" || d.category === "sop" || d.docType === "protocol").slice(0, 4);
    out.teachingFiles = scored.filter((d) => d.category === "teaching" || d.docType === "teaching").slice(0, 4);
    // Fallback: surface the top-scoring docs as teaching material.
    if (out.teachingFiles.length === 0) out.teachingFiles = scored.slice(0, 3);
  } catch {
    // knowledge table may not exist yet
  }

  // ── Similar historical cases (accepted observations from the same modality) ──
  try {
    const similar = await db
      .select({
        id: aiObservations.id,
        orthancStudyId: aiObservations.orthancStudyId,
        modality: aiObservations.modality,
        region: aiObservations.region,
        category: aiObservations.category,
        description: aiObservations.description,
        confidence: aiObservations.confidence,
        status: aiObservations.status,
        createdAt: aiObservations.createdAt,
      })
      .from(aiObservations)
      .where(and(eq(aiObservations.status, "accepted"), modality ? eq(aiObservations.modality, modality) : sql`true`))
      .orderBy(desc(aiObservations.createdAt))
      .limit(6);
    out.similarCases = similar;
  } catch {
    // ai_observations table may not exist yet
  }

  // ── FHIR laboratory summary (best-effort) ──
  if (patientMrn && integrationConfig.fhir.url) {
    try {
      const res = await timedFetch(
        `${integrationConfig.fhir.url.replace(/\/$/, "")}/Observation?subject.identifier=${encodeURIComponent(patientMrn)}&_sort=-date&_count=8`,
        { headers: { Accept: "application/fhir+json" } },
        6000
      );
      if (res.ok) {
        const json = (await res.json()) as { entry?: { resource?: { code?: { text?: string }; valueString?: string; valueQuantity?: { value?: number; unit?: string }; effectiveDateTime?: string } }[] };
        const labs = (json.entry ?? []).map((e) => {
          const r = e.resource ?? {};
          return `${r.code?.text ?? "Lab"}${r.valueQuantity ? `: ${r.valueQuantity.value} ${r.valueQuantity.unit}` : r.valueString ? `: ${r.valueString}` : ""}${r.effectiveDateTime ? ` (${r.effectiveDateTime.slice(0, 10)})` : ""}`;
        });
        out.fhirLabSummary = labs.length > 0 ? labs.join("\n") : "No laboratory results on the FHIR server for this patient.";
      } else {
        out.fhirLabSummary = "FHIR server reachable but returned no laboratory results.";
      }
    } catch {
      out.fhirLabSummary = null; // FHIR not configured/unreachable
    }
  }

  return NextResponse.json({ ok: true, ...out }, { headers: { "Cache-Control": "no-store" } });
}
