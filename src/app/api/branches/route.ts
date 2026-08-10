import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { branches } from "@/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** GET /api/branches — list all branches. */
export async function GET() {
  try {
    const result = await db.select().from(branches).orderBy(desc(branches.createdAt));
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch branches" }, { status: 500 });
  }
}

/** POST /api/branches { name, code, address, phone, email, managerName, status } */
export async function POST(request: NextRequest) {
    const { requireRoleOrFail } = await import("@/lib/auth/requireRole");
  const { error: authError } = await requireRoleOrFail(request as unknown as Request, ["administrator"]);
  if (authError) return authError;
try {
    const body = await request.json();
    if (!body?.name || !body?.code) {
      return NextResponse.json({ error: "name and code are required" }, { status: 400 });
    }
    const result = await db.insert(branches).values({
      name: body.name,
      code: body.code,
      address: body.address ?? null,
      phone: body.phone ?? null,
      email: body.email ?? null,
      managerName: body.managerName ?? null,
      status: body.status ?? "active",
    }).returning();
    return NextResponse.json(result[0], { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create branch" }, { status: 500 });
  }
}
