import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { payments, invoices, patients } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { generateReceiptNumber } from "@/lib/finance";
import { recordAudit } from "@/lib/audit";

export async function GET() {
  try {
    const result = await db
      .select({
        id: payments.id,
        receiptNumber: payments.receiptNumber,
        amount: payments.amount,
        method: payments.method,
        reference: payments.reference,
        receivedBy: payments.receivedBy,
        receivedAt: payments.receivedAt,
        invoiceNumber: invoices.invoiceNumber,
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
        patientMrn: patients.mrn,
      })
      .from(payments)
      .leftJoin(invoices, eq(payments.invoiceId, invoices.id))
      .leftJoin(patients, eq(payments.patientId, patients.id))
      .orderBy(desc(payments.receivedAt));

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch payments" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
    const { requireRoleOrFail } = await import("@/lib/auth/requireRole");
  const { error: authError } = await requireRoleOrFail(request as unknown as Request, ["administrator", "manager"]);
  if (authError) return authError;
try {
    const body = await request.json();
    const { invoiceId, patientId, amount, method, reference, receivedBy, notes } = body;

    const [payment] = await db
      .insert(payments)
      .values({
        receiptNumber: generateReceiptNumber(),
        invoiceId,
        patientId,
        amount: Number(amount).toFixed(2),
        method,
        reference: reference ?? null,
        receivedBy: receivedBy ?? "system",
        notes: notes ?? null,
      })
      .returning();

    // Update invoice amountPaid & status
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
    if (invoice) {
      const newPaid = parseFloat(invoice.amountPaid) + Number(amount);
      const total = parseFloat(invoice.totalAmount);
      const newStatus = newPaid >= total ? "paid" : newPaid > 0 ? "partial" : invoice.status;
      await db
        .update(invoices)
        .set({ amountPaid: newPaid.toFixed(2), status: newStatus, updatedAt: new Date() })
        .where(eq(invoices.id, invoiceId));
    }

    await recordAudit({
      action: "payment.recorded",
      module: "finance",
      entityType: "payment",
      entityId: payment.id,
      details: { receiptNumber: payment.receiptNumber, amount, method },
    });

    return NextResponse.json(payment, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to record payment", detail: String(error) }, { status: 500 });
  }
}
