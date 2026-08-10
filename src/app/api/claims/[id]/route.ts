import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { insuranceClaims } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
    const { requireRoleOrFail } = await import("@/lib/auth/requireRole");
  const { error: authError } = await requireRoleOrFail(request as unknown as Request, ["administrator", "manager"]);
  if (authError) return authError;
try {
    const { id } = await params;
    const body = await request.json();
    const updates: Record<string, unknown> = { ...body, updatedAt: new Date() };
    if (body.status && body.status !== "submitted" && body.status !== "pending") {
      updates.respondedAt = new Date();
    }
    const result = await db.update(insuranceClaims).set(updates).where(eq(insuranceClaims.id, id)).returning();
    if (result.length === 0) return NextResponse.json({ error: "Claim not found" }, { status: 404 });
    return NextResponse.json(result[0]);
  } catch (error) {
    return NextResponse.json({ error: "Failed to update claim" }, { status: 500 });
  }
}
