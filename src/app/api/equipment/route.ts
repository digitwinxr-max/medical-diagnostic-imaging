import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { equipment, maintenanceRecords } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

export async function GET() {
  try {
    const result = await db.select().from(equipment).orderBy(equipment.name);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch equipment" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
    const { requireRoleOrFail } = await import("@/lib/auth/requireRole");
  const { error: authError } = await requireRoleOrFail(request as unknown as Request, ["administrator"]);
  if (authError) return authError;
try {
    const body = await request.json();
    const result = await db.insert(equipment).values(body).returning();
    return NextResponse.json(result[0], { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create equipment" }, { status: 500 });
  }
}
