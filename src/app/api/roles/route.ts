import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { roles } from "@/db/schema";

export async function GET() {
  try {
    const result = await db.select().from(roles).orderBy(roles.name);
    // `permissions` is a jsonb column: some drivers/rows return it as a
    // serialized JSON string or a non-array value. Normalize to a real array
    // so the UI can always call `.map()` safely.
    return NextResponse.json(
      result.map((r) => ({
        ...r,
        permissions: normalizePermissions(r.permissions),
      }))
    );
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch roles" }, { status: 500 });
  }
}

function normalizePermissions(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === "string");
      if (parsed && typeof parsed === "object") return Object.keys(parsed).filter((k) => parsed[k] === true || typeof parsed[k] !== "boolean");
    } catch {
      /* not valid JSON — fall through */
    }
    return [];
  }
  // Legacy shape: permissions stored as a JSON object map, e.g. {"imaging":true,"reports":true}.
  if (value && typeof value === "object") {
    return Object.keys(value).filter((k) => (value as Record<string, unknown>)[k] !== false);
  }
  return [];
}

export async function POST(request: NextRequest) {
    const { requireRoleOrFail } = await import("@/lib/auth/requireRole");
  const { error: authError } = await requireRoleOrFail(request as unknown as Request, ["administrator"]);
  if (authError) return authError;
try {
    const body = await request.json();
    const result = await db
      .insert(roles)
      .values({
        name: body.name,
        description: body.description ?? null,
        permissions: Array.isArray(body.permissions) ? body.permissions : [],
        isSystem: false,
      })
      .returning();
    return NextResponse.json(result[0], { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create role" }, { status: 500 });
  }
}
