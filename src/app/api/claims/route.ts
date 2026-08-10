import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { insuranceClaims, invoices, patients } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { generateClaimNumber } from "@/lib/finance";
import { recordAudit } from "@/lib/audit";

export async function GET() {
  try {
    const result = await db
      .select({
        id: insuranceClaims.id,
        claimNumber: insuranceClaims.claimNumber,
        medicalAid: insuranceClaims.medicalAid,
        membershipNumber: insuranceClaims.membershipNumber,
        amountClaimed: insuranceClaims.amountClaimed,
        amountApproved: insuranceClaims.amountApproved,
        status: insuranceClaims.status,
        submittedAt: insuranceClaims.submittedAt,
        respondedAt: insuranceClaims.respondedAt,
        rejectionReason: insuranceClaims.rejectionReason,
        invoiceNumber: invoices.invoiceNumber,
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
        patientMrn: patients.mrn,
      })
      .from(insuranceClaims)
      .leftJoin(invoices, eq(insuranceClaims.invoiceId, invoices.id))
      .leftJoin(patients, eq(insuranceClaims.patientId, patients.id))
      .orderBy(desc(insuranceClaims.submittedAt));

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch claims" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
    const { requireRoleOrFail } = await import("@/lib/auth/requireRole");
  const { error: authError } = await requireRoleOrFail(request as unknown as Request, ["administrator", "manager"]);
  if (authError) return authError;
try {
    const body = await request.json();
    const [claim] = await db
      .insert(insuranceClaims)
      .values({
        claimNumber: generateClaimNumber(),
        invoiceId: body.invoiceId,
        patientId: body.patientId,
        medicalAid: body.medicalAid,
        membershipNumber: body.membershipNumber ?? null,
        amountClaimed: Number(body.amountClaimed).toFixed(2),
        status: "submitted",
        notes: body.notes ?? null,
      })
      .returning();

    await recordAudit({
      action: "claim.submitted",
      module: "finance",
      entityType: "insurance_claim",
      entityId: claim.id,
      details: { claimNumber: claim.claimNumber, medicalAid: body.medicalAid },
    });

    // Fire n8n workflow for claim submission automation
    try {
      const base = process.env.N8N_WEBHOOK_BASE || (process.env.N8N_URL ? `${process.env.N8N_URL}/webhook` : "");
      if (base) {
        await fetch(`${base}/insurance-claim-submitted`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ claimNumber: claim.claimNumber, medicalAid: body.medicalAid }),
          signal: AbortSignal.timeout(4000),
        });
      }
    } catch {
      // best-effort automation trigger
    }

    return NextResponse.json(claim, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to submit claim", detail: String(error) }, { status: 500 });
  }
}
