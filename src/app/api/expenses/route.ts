import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { expenses } from "@/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  try {
    const result = await db.select().from(expenses).orderBy(desc(expenses.incurredDate));
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch expenses" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
    const { requireRoleOrFail } = await import("@/lib/auth/requireRole");
  const { error: authError } = await requireRoleOrFail(request as unknown as Request, ["administrator", "manager"]);
  if (authError) return authError;
try {
    const body = await request.json();
    const result = await db
      .insert(expenses)
      .values({
        category: body.category,
        description: body.description,
        amount: Number(body.amount).toFixed(2),
        vendor: body.vendor ?? null,
        incurredDate: body.incurredDate ?? new Date().toISOString().split("T")[0],
        approvedBy: body.approvedBy ?? null,
        status: body.status ?? "pending",
      })
      .returning();
    return NextResponse.json(result[0], { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create expense" }, { status: 500 });
  }
}
