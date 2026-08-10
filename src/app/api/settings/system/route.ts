import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    const result = await db.select().from(systemSettings);
    const settingsMap: Record<string, unknown> = {};
    result.forEach((s) => { settingsMap[s.key] = s.value; });
    return NextResponse.json(settingsMap);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
    const { requireRoleOrFail } = await import("@/lib/auth/requireRole");
  const { error: authError } = await requireRoleOrFail(request as unknown as Request, ["administrator"]);
  if (authError) return authError;
try {
    const body = await request.json();
    const { key, value, updatedBy } = body;
    await db
      .insert(systemSettings)
      .values({ key, value, updatedBy: updatedBy ?? "system", updatedAt: new Date() })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value, updatedBy: updatedBy ?? "system", updatedAt: new Date() },
      });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to update setting" }, { status: 500 });
  }
}
