import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  patients,
  referrals,
  equipment,
  staff,
  appointments,
  workflowStudies,
  inventoryItems,
  inventoryTransactions,
  maintenanceRecords,
  reports,
  tariffs,
  invoices,
  invoiceLineItems,
  payments,
  insuranceClaims,
  expenses,
  branches,
  employeeRecords,
  roles,
  reportTemplates,
  reportVersions,
  aiObservations,
  aiRecommendations,
  knowledgeDocuments,
  studyBookmarks,
  studyAnnotations,
  eventLog,
  notifications,
  auditLog,
} from "@/db/schema";
import { generateMRN, generateAccessionNumber } from "@/lib/utils";
import { generateInvoiceNumber, generateReceiptNumber, generateClaimNumber, generateEmployeeNumber } from "@/lib/finance";
import { seedNewModules } from "@/lib/seed-new-modules";

// ─── Botswana localisation ───
// Botswana Pula (BWP), abbreviated "P". VAT in Botswana is 14%.
const VAT_RATE = 0.14;

// Real Botswana medical aid schemes (no foreign insurers).
const MEDICAL_AIDS = [
  "BOMAID",
  "BPOMAS",
  "Pula Medical Aid Fund",
  "IAL Medical Aid Scheme",
  "Oracle Medical Aid",
  "MMI Botswana",
] as const;

export async function POST(request: NextRequest) {
  // Defense-in-depth: production seeding is impossible
  const isProd = process.env.NODE_ENV === "production" || process.env.GERALDOS_ENV === "production";
  if (isProd) {
    return NextResponse.json({ error: "Seeding is disabled in production" }, { status: 403 });
  }
  // Non-production still requires administrator
  try {
    const { verifySessionToken } = await import("@/lib/auth/session");
    const { hasRole } = await import("@/lib/auth/requireRole");
    const cookie = request.cookies.get("geraldos_session")?.value;
    const user = cookie ? await verifySessionToken(cookie) : null;
    const isAdmin = user ? hasRole(user, "administrator") || hasRole(user, /admin/i) : false;
    // Allow unauthenticated only when DEV_AUTH and no Keycloak (dev demo seeding)
    const allowDevSeed = !isAdmin && !user && process.env.DEV_AUTH === "true" && !process.env.KEYCLOAK_URL;
    if (!isAdmin && !allowDevSeed) {
      return NextResponse.json({ error: "Seeding requires administrator role" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "Seeding requires administrator role" }, { status: 403 });
  }
  // Clean slate so re-seeding always yields exactly one consistent dataset.
  // Children first to satisfy foreign keys; each delete is isolated so a
  // missing table never aborts the seed.
  const RESET_ORDER = [
    payments, invoiceLineItems, insuranceClaims, reportVersions, reports, invoices,
    aiObservations, studyBookmarks, studyAnnotations, workflowStudies, appointments, referrals,
    employeeRecords, maintenanceRecords, inventoryTransactions, inventoryItems, expenses, tariffs,
    aiRecommendations, knowledgeDocuments, reportTemplates, eventLog, notifications, auditLog,
    branches, patients, staff, equipment,
  ];
  for (const table of RESET_ORDER) {
    try {
      await db.delete(table);
    } catch {
      /* table may not exist yet — ignore */
    }
  }

  try {
    // Seed staff
    const staffData = await db
      .insert(staff)
      .values([
        { firstName: "Thato", lastName: "Ramotswe", role: "radiologist", specialization: "Neuroradiology", email: "thato.ramotswe@gerald.co.bw", phone: "+267 71 100 101" },
        { firstName: "Kagiso", lastName: "Moeng", role: "radiologist", specialization: "Musculoskeletal", email: "kagiso.moeng@gerald.co.bw", phone: "+267 71 100 102" },
        { firstName: "Boitumelo", lastName: "Seretse", role: "radiologist", specialization: "Body Imaging", email: "boitumelo.seretse@gerald.co.bw", phone: "+267 71 100 103" },
        { firstName: "Tumelo", lastName: "Nkwe", role: "radiographer", specialization: "CT", email: "tumelo.nkwe@gerald.co.bw", phone: "+267 72 100 104" },
        { firstName: "Lorato", lastName: "Sebina", role: "radiographer", specialization: "MRI", email: "lorato.sebina@gerald.co.bw", phone: "+267 72 100 105" },
        { firstName: "Omphemetse", lastName: "Moilwa", role: "radiographer", specialization: "X-Ray", email: "omphemetse.moilwa@gerald.co.bw", phone: "+267 72 100 106" },
        { firstName: "Refilwe", lastName: "Mosinyi", role: "receptionist", email: "refilwe.mosinyi@gerald.co.bw", phone: "+267 71 100 107" },
      ])
      .returning();

    // Seed equipment
    const equipmentData = await db
      .insert(equipment)
      .values([
        { name: "CT Scanner 1", modality: "CT", manufacturer: "Siemens", model: "SOMATOM Force", serialNumber: "CT-001", location: "CT Suite 1, Gaborone", status: "operational", installDate: "2022-03-15", lastCalibration: "2024-11-01", nextCalibration: "2025-05-01", utilizationRate: "78.5" },
        { name: "CT Scanner 2", modality: "CT", manufacturer: "GE Healthcare", model: "Revolution CT", serialNumber: "CT-002", location: "CT Suite 2, Francistown", status: "operational", installDate: "2023-06-20", lastCalibration: "2024-12-15", nextCalibration: "2025-06-15", utilizationRate: "65.2" },
        { name: "MRI Scanner 1", modality: "MRI", manufacturer: "Siemens", model: "MAGNETOM Vida", serialNumber: "MRI-001", location: "MRI Suite, Gaborone", status: "operational", installDate: "2021-09-10", lastCalibration: "2024-10-20", nextCalibration: "2025-04-20", utilizationRate: "82.1" },
        { name: "MRI Scanner 2", modality: "MRI", manufacturer: "Philips", model: "Ingenia Ambition", serialNumber: "MRI-002", location: "MRI Suite, Maun", status: "maintenance", installDate: "2022-01-05", lastCalibration: "2024-08-15", nextCalibration: "2025-02-15", utilizationRate: "0.0" },
        { name: "X-Ray Room 1", modality: "X-Ray", manufacturer: "Siemens", model: "Ysio Max", serialNumber: "XR-001", location: "X-Ray Suite, Gaborone", status: "operational", installDate: "2020-11-30", lastCalibration: "2024-11-30", nextCalibration: "2025-05-30", utilizationRate: "91.3" },
        { name: "Ultrasound 1", modality: "Ultrasound", manufacturer: "GE Healthcare", model: "LOGIQ E10s", serialNumber: "US-001", location: "US Suite, Gaborone", status: "operational", installDate: "2023-02-14", lastCalibration: "2024-09-14", nextCalibration: "2025-03-14", utilizationRate: "55.8" },
        { name: "Mammography 1", modality: "Mammography", manufacturer: "Hologic", model: "Selenia Dimensions", serialNumber: "MG-001", location: "Mammo Suite, Gaborone", status: "operational", installDate: "2022-07-01", lastCalibration: "2024-07-01", nextCalibration: "2025-01-01", utilizationRate: "42.7" },
        { name: "Fluoroscopy 1", modality: "Fluoroscopy", manufacturer: "Philips", model: "ProxiDiagnost N90", serialNumber: "FL-001", location: "Fluoro Suite, Francistown", status: "offline", installDate: "2019-04-22", lastCalibration: "2024-04-22", nextCalibration: "2024-10-22", utilizationRate: "0.0" },
      ])
      .returning();

    // Seed patients — Setswana names, Botswana towns, local medical aids.
    const patientData = await db
      .insert(patients)
      .values([
        { mrn: generateMRN(), firstName: "Kagiso", lastName: "Molefe", dateOfBirth: "1985-03-12", gender: "Male", phone: "+267 71 555 101", email: "kagiso.molefe@mail.co.bw", address: "Plot 5419, Extension 2, Gaborone", insuranceProvider: "BOMAID", insurancePolicyNumber: "BOM-2024-001", consentSigned: true, status: "active" },
        { mrn: generateMRN(), firstName: "Boitumelo", lastName: "Seretse", dateOfBirth: "1992-07-25", gender: "Female", phone: "+267 72 555 202", email: "boitumelo.s@mail.co.bw", address: "Plot 118, Broadhurst, Gaborone", insuranceProvider: "BPOMAS", insurancePolicyNumber: "BPO-2024-012", consentSigned: true, status: "active" },
        { mrn: generateMRN(), firstName: "Thato", lastName: "Kgosi", dateOfBirth: "1978-11-03", gender: "Male", phone: "+267 74 555 303", email: "thato.k@mail.co.bw", address: "Plot 27, Blue Jacket Street, Francistown", insuranceProvider: "Pula Medical Aid Fund", insurancePolicyNumber: "PUL-2024-034", consentSigned: true, status: "active" },
        { mrn: generateMRN(), firstName: "Onalenna", lastName: "Modise", dateOfBirth: "1990-05-18", gender: "Female", phone: "+267 75 555 404", email: "onalenna.m@mail.co.bw", address: "Plot 880, Maun", insuranceProvider: "IAL Medical Aid Scheme", insurancePolicyNumber: "IAL-2024-056", consentSigned: false, status: "active" },
        { mrn: generateMRN(), firstName: "Tebogo", lastName: "Ramotswe", dateOfBirth: "1967-09-30", gender: "Male", phone: "+267 76 555 505", email: "tebogo.r@mail.co.bw", address: "Plot 45, Molepolole", insuranceProvider: "BOMAID", insurancePolicyNumber: "BOM-2024-078", consentSigned: true, status: "active" },
        { mrn: generateMRN(), firstName: "Neo", lastName: "Moeng", dateOfBirth: "1995-01-14", gender: "Female", phone: "+267 77 555 606", email: "neo.moeng@mail.co.bw", address: "Plot 12, Palapye", insuranceProvider: "Oracle Medical Aid", insurancePolicyNumber: "ORC-2024-090", consentSigned: true, status: "active" },
        { mrn: generateMRN(), firstName: "Tshepo", lastName: "Khama", dateOfBirth: "1982-12-07", gender: "Male", phone: "+267 71 555 707", email: "tshepo.k@mail.co.bw", address: "Plot 330, Selebi-Phikwe", insuranceProvider: "BPOMAS", insurancePolicyNumber: "BPO-2024-102", consentSigned: true, status: "active" },
        { mrn: generateMRN(), firstName: "Kelebogile", lastName: "Tau", dateOfBirth: "1988-04-22", gender: "Female", phone: "+267 72 555 808", email: "kelebogile.t@mail.co.bw", address: "Plot 6, Ghanzi", insuranceProvider: "MMI Botswana", insurancePolicyNumber: "MMI-2024-113", consentSigned: true, status: "active" },
      ])
      .returning();

    // Seed referrals — Botswana referring physicians and facilities.
    const referralData = await db
      .insert(referrals)
      .values([
        { patientId: patientData[0].id, referringPhysician: "Dr. M. Kgosi", referringFacility: "Princess Marina Hospital", clinicalIndication: "Persistent headaches, rule out intracranial pathology", requestedProcedure: "CT Brain", priority: "urgent", status: "accepted" },
        { patientId: patientData[1].id, referringPhysician: "Dr. P. Modukanele", referringFacility: "Gaborone Private Hospital", clinicalIndication: "Right knee pain post-injury, query meniscal tear", requestedProcedure: "MRI Knee", priority: "routine", status: "accepted" },
        { patientId: patientData[2].id, referringPhysician: "Dr. B. Rantao", referringFacility: "Bokamoso Private Hospital", clinicalIndication: "Chest pain, shortness of breath", requestedProcedure: "CT Chest", priority: "stat", status: "accepted" },
        { patientId: patientData[3].id, referringPhysician: "Dr. L. Maribe", referringFacility: "Nyangabgwe Referral Hospital", clinicalIndication: "Annual screening mammogram", requestedProcedure: "Mammography", priority: "routine", status: "pending" },
        { patientId: patientData[4].id, referringPhysician: "Dr. K. Dube", referringFacility: "Sidilega Private Hospital", clinicalIndication: "Lower back pain radiating to left leg", requestedProcedure: "MRI Lumbar Spine", priority: "urgent", status: "accepted" },
      ])
      .returning();

    // Seed appointments
    const today = new Date().toISOString().split("T")[0];
    const appointmentData = await db
      .insert(appointments)
      .values([
        { patientId: patientData[0].id, referralId: referralData[0].id, equipmentId: equipmentData[0].id, radiographerId: staffData[3].id, scheduledDate: today, scheduledTime: "08:30", duration: 30, modality: "CT", procedure: "CT Brain", priority: "urgent", status: "in_progress", checkedIn: true, checkedInAt: new Date() },
        { patientId: patientData[1].id, referralId: referralData[1].id, equipmentId: equipmentData[2].id, radiographerId: staffData[4].id, scheduledDate: today, scheduledTime: "09:00", duration: 45, modality: "MRI", procedure: "MRI Knee", priority: "routine", status: "checked_in", checkedIn: true, checkedInAt: new Date() },
        { patientId: patientData[2].id, referralId: referralData[2].id, equipmentId: equipmentData[0].id, radiographerId: staffData[3].id, scheduledDate: today, scheduledTime: "10:00", duration: 30, modality: "CT", procedure: "CT Chest", priority: "stat", status: "scheduled" },
        { patientId: patientData[4].id, referralId: referralData[4].id, equipmentId: equipmentData[2].id, radiographerId: staffData[4].id, scheduledDate: today, scheduledTime: "11:00", duration: 45, modality: "MRI", procedure: "MRI Lumbar Spine", priority: "urgent", status: "scheduled" },
        { patientId: patientData[5].id, equipmentId: equipmentData[4].id, radiographerId: staffData[5].id, scheduledDate: today, scheduledTime: "11:30", duration: 15, modality: "X-Ray", procedure: "Chest X-Ray", priority: "routine", status: "scheduled" },
        { patientId: patientData[6].id, equipmentId: equipmentData[5].id, radiographerId: staffData[5].id, scheduledDate: today, scheduledTime: "14:00", duration: 30, modality: "Ultrasound", procedure: "Abdominal Ultrasound", priority: "routine", status: "scheduled" },
      ])
      .returning();

    // ─── Workflow studies — seeded across the full 12-stage pipeline ───
    // Stages that require a real Orthanc UID (sent_to_orthanc onwards) are only
    // kept there when Orthanc returns a matching study; otherwise they are
    // downgraded to `study_created` — no fake UIDs, ever.
    const orthancStudies = await fetchOrthancStudies();
    const claimedUids = new Set<string>();
    // Modality-exact matching only — a CT study UID is never linked to an MRI
    // workflow entry. If no matching modality exists in Orthanc, the study is
    // honestly downgraded to `study_created` (no fake linkage).
    // RIS modality → accepted DICOM modality values.
    const MODALITY_MAP: Record<string, string[]> = {
      "CT": ["CT"],
      "MRI": ["MR"],
      "X-RAY": ["CR", "DX", "XA", "RF", "XG"],
      "ULTRASOUND": ["US"],
      "MAMMOGRAPHY": ["MG"],
      "PET-CT": ["PT", "CT"],
      "NUCLEAR MEDICINE": ["NM"],
      "DEXA": ["BMD", "DXA"],
      "FLUOROSCOPY": ["RF", "XA"],
    };
    const modalityMatches = (dicomModality: string, risModality: string): boolean => {
      const d = dicomModality.toUpperCase();
      const r = risModality.toUpperCase();
      if (d === r) return true;
      return (MODALITY_MAP[r] ?? []).includes(d);
    };
    // Normalise a DICOM patient name to a comparable form ("Molefe^Kagiso" ->
    // "molefe kagiso", and the RIS full name "Kagiso Molefe" -> "molefe kagiso").
    const nameKey = (s: string | null | undefined): string =>
      (s ?? "").replace(/[\^_]/g, " ").toLowerCase().split(/\s+/).filter(Boolean).sort().join(" ");
    const uidFor = (modality: string, patientName?: string | null): string | null => {
      const key = patientName ? nameKey(patientName) : null;
      // Prefer an exact patient-name match (sample DICOMs are named to match the
      // RIS patients), then fall back to modality-only matching.
      const matches = orthancStudies.filter(
        (o) => modalityMatches(o.modalities, modality) && !claimedUids.has(o.studyInstanceUid)
      );
      const byName = key ? matches.find((o) => nameKey(o.patientName) === key) : undefined;
      const match = byName ?? matches[0];
      if (!match) return null;
      claimedUids.add(match.studyInstanceUid);
      return match.studyInstanceUid;
    };

    const needsUid = (modality: string, stage: string, patientName?: string | null): string | null => {
      const requiresPacs = ["sent_to_orthanc", "assigned", "opened", "review", "report_draft", "signed", "released", "archived"].includes(stage);
      return requiresPacs ? uidFor(modality, patientName) : null;
    };

    const patientById = new Map(patientData.map((p) => [p.id, p]));

    const seededWorkflows = [
      { appointmentId: appointmentData[0].id, patientId: patientData[0].id, modality: "CT", procedure: "CT Brain", bodyPart: "Brain", stage: "review", radiologistId: staffData[0].id, priority: "urgent", startedAt: new Date(Date.now() - 7200000) },
      { appointmentId: appointmentData[1].id, patientId: patientData[1].id, modality: "MRI", procedure: "MRI Knee", bodyPart: "Knee", stage: "sent_to_orthanc", priority: "routine" },
      { patientId: patientData[2].id, modality: "CT", procedure: "CT Chest", bodyPart: "Chest", stage: "referral", priority: "stat" },
      { appointmentId: appointmentData[2].id, patientId: patientData[3].id, modality: "Mammography", procedure: "Screening Mammogram", bodyPart: "Breast", stage: "arrival", priority: "routine" },
      { appointmentId: appointmentData[3].id, patientId: patientData[4].id, modality: "MRI", procedure: "MRI Lumbar Spine", bodyPart: "Lumbar Spine", stage: "assigned", radiologistId: staffData[1].id, priority: "urgent" },
      { appointmentId: appointmentData[4].id, patientId: patientData[5].id, modality: "X-Ray", procedure: "Chest X-Ray", bodyPart: "Chest", stage: "released", radiologistId: staffData[1].id, priority: "routine", startedAt: new Date(Date.now() - 18000000), completedAt: new Date(Date.now() - 7200000) },
      { appointmentId: appointmentData[5].id, patientId: patientData[6].id, modality: "Ultrasound", procedure: "Abdominal Ultrasound", bodyPart: "Abdomen", stage: "report_draft", radiologistId: staffData[2].id, priority: "routine", startedAt: new Date(Date.now() - 3600000) },
      { patientId: patientData[7].id, modality: "CT", procedure: "CT Abdomen & Pelvis", bodyPart: "Abdomen", stage: "study_created", priority: "routine" },
    ];

    const workflowData = await db
      .insert(workflowStudies)
      .values(
        seededWorkflows.map((w) => {
          const pat = patientById.get(w.patientId);
          const uid = needsUid(w.modality, w.stage, pat ? `${pat.firstName} ${pat.lastName}` : null);
          return {
            appointmentId: w.appointmentId ?? null,
            patientId: w.patientId,
            accessionNumber: generateAccessionNumber(),
            studyInstanceUid: uid,
            modality: w.modality,
            procedure: w.procedure,
            bodyPart: w.bodyPart,
            // Honest stage: without a real Orthanc UID the study cannot sit past `study_created`.
            stage: uid ? w.stage : (needsUidStage(w.stage) ? "study_created" : w.stage),
            radiologistId: w.radiologistId ?? null,
            priority: w.priority,
            startedAt: w.startedAt ?? null,
            completedAt: w.completedAt ?? null,
          };
        })
      )
      .returning();

    function needsUidStage(stage: string): boolean {
      return ["sent_to_orthanc", "assigned", "opened", "review", "report_draft", "signed", "released", "archived"].includes(stage);
    }

    // Seed inventory — Botswana suppliers, Pula pricing
    await db.insert(inventoryItems).values([
      { name: "Omnipaque 350 (100ml)", category: "contrast", sku: "CON-001", currentStock: 45, minimumStock: 20, maximumStock: 100, unit: "vials", unitCost: "520.00", supplier: "Medical Distributors Botswana", location: "Contrast Room A, Gaborone", status: "in_stock" },
      { name: "Omnipaque 300 (50ml)", category: "contrast", sku: "CON-002", currentStock: 8, minimumStock: 15, maximumStock: 80, unit: "vials", unitCost: "340.00", supplier: "Medical Distributors Botswana", location: "Contrast Room A, Gaborone", status: "low_stock" },
      { name: "Gadovist 1.0 (15ml)", category: "contrast", sku: "CON-003", currentStock: 22, minimumStock: 10, maximumStock: 50, unit: "vials", unitCost: "780.00", supplier: "Bayer Botswana", location: "MRI Suite, Gaborone", status: "in_stock" },
      { name: "Ultrasound Gel (5L)", category: "gel", sku: "GEL-001", currentStock: 12, minimumStock: 5, maximumStock: 30, unit: "bottles", unitCost: "95.00", supplier: "Health Mart Botswana", location: "Store Room B", status: "in_stock" },
      { name: "Nitrile Gloves (M)", category: "ppe", sku: "PPE-001", currentStock: 3, minimumStock: 10, maximumStock: 50, unit: "boxes", unitCost: "48.00", supplier: "SafeCare Botswana", location: "Store Room A", status: "low_stock" },
      { name: "Nitrile Gloves (L)", category: "ppe", sku: "PPE-002", currentStock: 15, minimumStock: 10, maximumStock: 50, unit: "boxes", unitCost: "48.00", supplier: "SafeCare Botswana", location: "Store Room A", status: "in_stock" },
      { name: "ECG Electrodes (pack 50)", category: "electrodes", sku: "ELE-001", currentStock: 5, minimumStock: 8, maximumStock: 40, unit: "packs", unitCost: "75.00", supplier: "MedTech Botswana", location: "Store Room A", status: "low_stock" },
      { name: "Patient Gowns (disposable)", category: "consumables", sku: "CSM-001", currentStock: 200, minimumStock: 100, maximumStock: 500, unit: "units", unitCost: "12.50", supplier: "MedDisposables Botswana", location: "Store Room C", status: "in_stock" },
      { name: "Contrast Syringes (200ml)", category: "consumables", sku: "CSM-002", currentStock: 30, minimumStock: 20, maximumStock: 100, unit: "units", unitCost: "28.00", supplier: "MedTech Botswana", location: "Contrast Room A", status: "in_stock" },
      { name: "IV Cannulas (20G)", category: "consumables", sku: "CSM-003", currentStock: 2, minimumStock: 25, maximumStock: 100, unit: "boxes", unitCost: "38.00", supplier: "B. Braun Botswana", location: "Store Room A", status: "low_stock" },
    ]);

    // Seed maintenance records
    await db.insert(maintenanceRecords).values([
      { equipmentId: equipmentData[3].id, type: "corrective", description: "Gradient coil replacement - intermittent artifact on sequences", performedBy: "Philips Botswana Service Engineer", scheduledDate: today, status: "in_progress", cost: "74500.00" },
      { equipmentId: equipmentData[7].id, type: "corrective", description: "X-ray tube replacement required", performedBy: "Philips Botswana Service Engineer", scheduledDate: today, status: "scheduled", cost: "52000.00" },
      { equipmentId: equipmentData[0].id, type: "preventive", description: "Annual PM service and calibration", performedBy: "Siemens Botswana Service", scheduledDate: "2025-05-01", status: "scheduled", cost: "28000.00" },
    ]);

    // Seed one report — only signed if the study truly reached the PACS and is
    // reportable; otherwise seed a draft so the data never contradicts itself.
    const xrayStudy = workflowData[5];
    await db.insert(reports).values([
      {
        studyId: xrayStudy.id,
        patientId: patientData[5].id,
        radiologistId: staffData[1].id,
        templateName: "Chest X-Ray Standard",
        findings: "Heart size normal. Lungs are clear bilaterally. No pleural effusion. No pneumothorax. Mediastinal contours normal. Bony thorax intact.",
        impression: "Normal chest radiograph.",
        recommendation: "No further imaging required.",
        status: xrayStudy.stage === "released" ? "signed" : "draft",
        signedAt: xrayStudy.stage === "released" ? new Date(Date.now() - 7200000) : null,
      },
    ]);

    // ─── FINANCE: Tariffs — Botswana Pula price list (cash / medical aid) ───
    const tariffData = await db
      .insert(tariffs)
      .values([
        { code: "CT-BRAIN-01", description: "CT Brain (non-contrast)", modality: "CT", cashPrice: "1650.00", medicalAidPrice: "2100.00", nappiCode: "BW-CT-001" },
        { code: "CT-CHEST-01", description: "CT Chest", modality: "CT", cashPrice: "1950.00", medicalAidPrice: "2480.00", nappiCode: "BW-CT-002" },
        { code: "CT-ABD-01", description: "CT Abdomen & Pelvis", modality: "CT", cashPrice: "2350.00", medicalAidPrice: "2990.00", nappiCode: "BW-CT-003" },
        { code: "MRI-KNEE-01", description: "MRI Knee", modality: "MRI", cashPrice: "2850.00", medicalAidPrice: "3600.00", nappiCode: "BW-MRI-001" },
        { code: "MRI-BRAIN-01", description: "MRI Brain", modality: "MRI", cashPrice: "3150.00", medicalAidPrice: "3980.00", nappiCode: "BW-MRI-002" },
        { code: "MRI-SPINE-01", description: "MRI Lumbar Spine", modality: "MRI", cashPrice: "2950.00", medicalAidPrice: "3720.00", nappiCode: "BW-MRI-003" },
        { code: "XR-CHEST-01", description: "Chest X-Ray (2 views)", modality: "X-Ray", cashPrice: "320.00", medicalAidPrice: "410.00", nappiCode: "BW-XR-001" },
        { code: "US-ABD-01", description: "Abdominal Ultrasound", modality: "Ultrasound", cashPrice: "620.00", medicalAidPrice: "790.00", nappiCode: "BW-US-001" },
        { code: "MG-SCREEN-01", description: "Mammography Screening (bilateral)", modality: "Mammography", cashPrice: "750.00", medicalAidPrice: "950.00", nappiCode: "BW-MG-001" },
      ])
      .returning();

    // ─── FINANCE: Invoices — with 14% Botswana VAT, local medical aids ───
    const invoiceRows = [
      { patientId: patientData[0].id, billingType: "medical_aid", insuranceProvider: "BOMAID", insurancePolicyNumber: "BOM-2024-001", tariff: tariffData[0], status: "paid" },
      { patientId: patientData[1].id, billingType: "medical_aid", insuranceProvider: "BPOMAS", insurancePolicyNumber: "BPO-2024-012", tariff: tariffData[3], status: "partial" },
      { patientId: patientData[2].id, billingType: "cash", insuranceProvider: null, insurancePolicyNumber: null, tariff: tariffData[1], status: "sent" },
      { patientId: patientData[4].id, billingType: "medical_aid", insuranceProvider: "Pula Medical Aid Fund", insurancePolicyNumber: "PUL-2024-034", tariff: tariffData[5], status: "sent" },
      { patientId: patientData[6].id, billingType: "cash", insuranceProvider: null, insurancePolicyNumber: null, tariff: tariffData[7], status: "paid" },
      { patientId: patientData[7].id, billingType: "medical_aid", insuranceProvider: "IAL Medical Aid Scheme", insurancePolicyNumber: "IAL-2024-056", tariff: tariffData[2], status: "overdue" },
    ];

    const invoiceData = [];
    for (const row of invoiceRows) {
      const unitPrice = parseFloat(row.billingType === "medical_aid" ? row.tariff.medicalAidPrice : row.tariff.cashPrice);
      const taxAmount = Math.round(unitPrice * VAT_RATE * 100) / 100;
      const totalAmount = Math.round((unitPrice + taxAmount) * 100) / 100;
      const [invoice] = await db
        .insert(invoices)
        .values({
          invoiceNumber: generateInvoiceNumber(),
          patientId: row.patientId,
          billingType: row.billingType,
          insuranceProvider: row.insuranceProvider,
          insurancePolicyNumber: row.insurancePolicyNumber,
          subtotal: unitPrice.toFixed(2),
          taxAmount: taxAmount.toFixed(2),
          totalAmount: totalAmount.toFixed(2),
          amountPaid: row.status === "paid" ? totalAmount.toFixed(2) : row.status === "partial" ? (totalAmount * 0.5).toFixed(2) : "0.00",
          status: row.status,
          issueDate: today,
          dueDate: today,
        })
        .returning();
      await db.insert(invoiceLineItems).values({
        invoiceId: invoice.id,
        tariffId: row.tariff.id,
        description: row.tariff.description,
        quantity: 1,
        unitPrice: unitPrice.toFixed(2),
        lineTotal: unitPrice.toFixed(2),
      });
      invoiceData.push({ invoice, totalAmount, unitPrice, patientId: row.patientId });
    }

    // ─── FINANCE: Payments (receipts) ───
    await db.insert(payments).values([
      { receiptNumber: generateReceiptNumber(), invoiceId: invoiceData[0].invoice.id, patientId: invoiceData[0].patientId, amount: invoiceData[0].totalAmount.toFixed(2), method: "medical_aid", reference: "BOM-AUTH-88213", receivedBy: "Refilwe Mosinyi" },
      { receiptNumber: generateReceiptNumber(), invoiceId: invoiceData[1].invoice.id, patientId: invoiceData[1].patientId, amount: (invoiceData[1].totalAmount * 0.5).toFixed(2), method: "eft", reference: "EFT-773421", receivedBy: "Refilwe Mosinyi" },
      { receiptNumber: generateReceiptNumber(), invoiceId: invoiceData[4].invoice.id, patientId: invoiceData[4].patientId, amount: invoiceData[4].totalAmount.toFixed(2), method: "card", reference: "CARD-556123", receivedBy: "Refilwe Mosinyi" },
    ]);

    // ─── FINANCE: Insurance Claims — local medical aid schemes only ───
    await db.insert(insuranceClaims).values([
      { claimNumber: generateClaimNumber(), invoiceId: invoiceData[0].invoice.id, patientId: invoiceData[0].patientId, medicalAid: "BOMAID", membershipNumber: "BOM-2024-001", amountClaimed: invoiceData[0].totalAmount.toFixed(2), amountApproved: invoiceData[0].totalAmount.toFixed(2), status: "paid", respondedAt: new Date() },
      { claimNumber: generateClaimNumber(), invoiceId: invoiceData[1].invoice.id, patientId: invoiceData[1].patientId, medicalAid: "BPOMAS", membershipNumber: "BPO-2024-012", amountClaimed: invoiceData[1].totalAmount.toFixed(2), status: "pending" },
      { claimNumber: generateClaimNumber(), invoiceId: invoiceData[2].invoice.id, patientId: invoiceData[2].patientId, medicalAid: "Pula Medical Aid Fund", membershipNumber: "PUL-2024-034", amountClaimed: invoiceData[2].totalAmount.toFixed(2), status: "submitted" },
      { claimNumber: generateClaimNumber(), invoiceId: invoiceData[5].invoice.id, patientId: invoiceData[5].patientId, medicalAid: "IAL Medical Aid Scheme", membershipNumber: "IAL-2024-056", amountClaimed: invoiceData[5].totalAmount.toFixed(2), amountApproved: "0.00", status: "rejected", rejectionReason: "Pre-authorisation not obtained", respondedAt: new Date() },
    ]);

    // ─── FINANCE: Expenses — Botswana vendors, realistic Pula figures ───
    await db.insert(expenses).values([
      { category: "supplies", description: "Contrast media restock (Omnipaque 350)", amount: "2700.00", vendor: "Medical Distributors Botswana", incurredDate: today, status: "approved", approvedBy: "Finance Officer" },
      { category: "maintenance", description: "Routine service — CT Scanner 1 filter set", amount: "1850.00", vendor: "Siemens Botswana", incurredDate: today, status: "approved", approvedBy: "Finance Officer" },
      { category: "utilities", description: "Electricity top-up — Gaborone branch", amount: "2400.00", vendor: "Botswana Power Corporation", incurredDate: today, status: "paid", approvedBy: "Finance Officer" },
      { category: "salaries", description: "Radiographer overtime — August", amount: "980.00", vendor: null, incurredDate: today, status: "pending" },
    ]);

    // ─── ADMINISTRATION: Branches — Botswana imaging centres ───
    const branchData = await db
      .insert(branches)
      .values([
        { name: "Gaborone Imaging Centre", code: "BR-GAB", address: "Plot 6450, Prime Plaza, Gaborone", phone: "+267 390 5550", email: "gaborone@gerald.co.bw", managerName: "Dr Thato Ramotswe", status: "active" },
        { name: "Francistown Imaging Centre", code: "BR-FRA", address: "Blue Jacket Street, Francistown", phone: "+267 241 5550", email: "francistown@gerald.co.bw", managerName: "Dr Kagiso Moeng", status: "active" },
        { name: "Maun Imaging Centre", code: "BR-MAU", address: "Mogapinyana Ward, Maun", phone: "+267 686 5550", email: "maun@gerald.co.bw", managerName: "Dr Boitumelo Seretse", status: "active" },
      ])
      .returning();

    // ─── ADMINISTRATION: Employee records — Pula salaries ───
    await db.insert(employeeRecords).values([
      { staffId: staffData[0].id, employeeNumber: generateEmployeeNumber(), department: "Radiology", employmentType: "full_time", branchId: branchData[0].id, startDate: "2020-02-01", monthlySalary: "58000.00", status: "active" },
      { staffId: staffData[1].id, employeeNumber: generateEmployeeNumber(), department: "Radiology", employmentType: "full_time", branchId: branchData[1].id, startDate: "2019-06-15", monthlySalary: "52000.00", status: "active" },
      { staffId: staffData[2].id, employeeNumber: generateEmployeeNumber(), department: "Radiology", employmentType: "contract", branchId: branchData[2].id, startDate: "2022-01-10", monthlySalary: "48000.00", status: "active" },
      { staffId: staffData[3].id, employeeNumber: generateEmployeeNumber(), department: "Imaging Operations", employmentType: "full_time", branchId: branchData[0].id, startDate: "2021-03-01", monthlySalary: "18500.00", status: "active" },
      { staffId: staffData[4].id, employeeNumber: generateEmployeeNumber(), department: "Imaging Operations", employmentType: "full_time", branchId: branchData[0].id, startDate: "2021-08-15", monthlySalary: "17200.00", status: "active" },
      { staffId: staffData[5].id, employeeNumber: generateEmployeeNumber(), department: "Imaging Operations", employmentType: "part_time", branchId: branchData[1].id, startDate: "2023-04-01", hourlyRate: "105.00", status: "active" },
      { staffId: staffData[6].id, employeeNumber: generateEmployeeNumber(), department: "Front Office", employmentType: "full_time", branchId: branchData[0].id, startDate: "2022-09-01", monthlySalary: "9800.00", status: "active" },
    ]);

    // ─── ADMINISTRATION: Roles ───
    await db.insert(roles).values([
      { name: "administrator", description: "Full platform access across all modules", permissions: ["*"], isSystem: true },
      { name: "radiologist", description: "Viewer, reporting, and workflow review access", permissions: ["imaging:read", "reports:write", "workflow:review"], isSystem: true },
      { name: "radiographer", description: "Imaging execution, equipment and scheduling access", permissions: ["workflow:imaging", "equipment:read", "scheduling:write"], isSystem: true },
      { name: "receptionist", description: "Reception, registration, and scheduling access", permissions: ["reception:write", "scheduling:write", "billing:read"], isSystem: true },
      { name: "manager", description: "Dashboard, reporting, equipment & inventory access", permissions: ["dashboard:read", "reports:read", "equipment:write", "inventory:write"], isSystem: true },
      { name: "finance_officer", description: "Billing, invoicing, payments and insurance claims", permissions: ["finance:write", "billing:write", "claims:write"], isSystem: false },
    ]).onConflictDoNothing();

    // New platform modules (templates, knowledge, events, decisions, AI review, …)
    await seedNewModules();

    return NextResponse.json({
      success: true,
      message: "Database seeded successfully",
      localisation: {
        country: "Botswana",
        currency: "Botswana Pula (BWP) — formatted with the P symbol",
        vatRate: "14%",
        medicalAids: MEDICAL_AIDS,
        patientsSeeded: patientData.length,
        workflowStudiesSeeded: workflowData.length,
        orthancStudiesLinked: claimedUids.size,
      },
    });
  } catch (error) {
    console.error("Seed error:", error);
    return NextResponse.json({ error: "Failed to seed database", details: String(error) }, { status: 500 });
  }
}

interface OrthancStudyLite {
  studyInstanceUid: string;
  modalities: string;
  patientName: string | null;
}

/**
 * Fetch the real study UIDs currently stored in Orthanc via DICOMweb QIDO-RS
 * (best-effort, no fake data). Returns [] when Orthanc is unreachable.
 */
async function fetchOrthancStudies(): Promise<OrthancStudyLite[]> {
  try {
    const base = process.env.ORTHANC_URL ?? "http://localhost:8042";
    const user = process.env.ORTHANC_USERNAME ?? "orthanc";
    const pass = process.env.ORTHANC_PASSWORD ?? "orthanc";
    const auth = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
    const res = await fetch(`${base}/dicom-web/studies`, {
      headers: { Authorization: auth, Accept: "application/dicom+json" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    const list = (await res.json()) as Record<string, { Value?: (string | { Alphabetic?: string })[] }>[];
    return list.map((study) => {
      const asString = (v: string | { Alphabetic?: string } | undefined): string =>
        typeof v === "string" ? v : (v as { Alphabetic?: string } | undefined)?.Alphabetic ?? "";
      const patientName = asString(study["00100010"]?.Value?.[0]) || null;
      return {
        studyInstanceUid: asString(study["0020000D"]?.Value?.[0]),
        // ModalitiesInStudy (0008,0061); fall back to Modality (0008,0060).
        modalities: asString(study["00080061"]?.Value?.[0]) || asString(study["00080060"]?.Value?.[0]),
        patientName,
      };
    }).filter((s) => s.studyInstanceUid);
  } catch {
    return [];
  }
}
