import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { invoices, invoiceLineItems, patients } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { generateInvoiceNumber } from "@/lib/finance";
import { recordAudit } from "@/lib/audit";

export async function GET() {
  try {
    const result = await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        patientId: invoices.patientId,
        billingType: invoices.billingType,
        insuranceProvider: invoices.insuranceProvider,
        subtotal: invoices.subtotal,
        taxAmount: invoices.taxAmount,
        totalAmount: invoices.totalAmount,
        amountPaid: invoices.amountPaid,
        status: invoices.status,
        issueDate: invoices.issueDate,
        dueDate: invoices.dueDate,
        createdAt: invoices.createdAt,
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
        patientMrn: patients.mrn,
      })
      .from(invoices)
      .leftJoin(patients, eq(invoices.patientId, patients.id))
      .orderBy(desc(invoices.createdAt));

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch invoices" }, { status: 500 });
  }
}

interface LineItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
  tariffId?: string;
}

export async function POST(request: NextRequest) {
    const { requireRoleOrFail } = await import("@/lib/auth/requireRole");
  const { error: authError } = await requireRoleOrFail(request as unknown as Request, ["administrator", "manager"]);
  if (authError) return authError;
try {
    const body = await request.json();
    const lineItems: LineItemInput[] = body.lineItems ?? [];
    const subtotal = lineItems.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0);
    const taxAmount = 0; // Medical imaging is VAT-exempt in most jurisdictions
    const totalAmount = subtotal + taxAmount;

    const [invoice] = await db
      .insert(invoices)
      .values({
        invoiceNumber: generateInvoiceNumber(),
        patientId: body.patientId,
        studyId: body.studyId ?? null,
        appointmentId: body.appointmentId ?? null,
        billingType: body.billingType ?? "cash",
        insuranceProvider: body.insuranceProvider ?? null,
        insurancePolicyNumber: body.insurancePolicyNumber ?? null,
        subtotal: subtotal.toFixed(2),
        taxAmount: taxAmount.toFixed(2),
        totalAmount: totalAmount.toFixed(2),
        status: "sent",
        issueDate: body.issueDate ?? new Date().toISOString().split("T")[0],
        dueDate: body.dueDate ?? null,
        notes: body.notes ?? null,
      })
      .returning();

    if (lineItems.length > 0) {
      await db.insert(invoiceLineItems).values(
        lineItems.map((li) => ({
          invoiceId: invoice.id,
          tariffId: li.tariffId ?? null,
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unitPrice.toFixed(2),
          lineTotal: (li.quantity * li.unitPrice).toFixed(2),
        }))
      );
    }

    await recordAudit({
      action: "invoice.created",
      module: "finance",
      entityType: "invoice",
      entityId: invoice.id,
      details: { invoiceNumber: invoice.invoiceNumber, totalAmount },
    });

    return NextResponse.json(invoice, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create invoice", detail: String(error) }, { status: 500 });
  }
}
