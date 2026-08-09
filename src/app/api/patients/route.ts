import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { patients } from "@/db/schema";
import { ilike, or, desc } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams.get("search") || "";

  try {
    const conditions = search
      ? or(
          ilike(patients.firstName, `%${search}%`),
          ilike(patients.lastName, `%${search}%`),
          ilike(patients.mrn, `%${search}%`)
        )
      : undefined;

    const result = conditions
      ? await db.select().from(patients).where(conditions).orderBy(desc(patients.createdAt))
      : await db.select().from(patients).orderBy(desc(patients.createdAt));

    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch patients" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await db.insert(patients).values(body).returning();
    return NextResponse.json(result[0], { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create patient" }, { status: 500 });
  }
}
