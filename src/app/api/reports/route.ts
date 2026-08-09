import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { reports, patients, staff } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  try {
    const result = await db
      .select({
        id: reports.id,
        studyId: reports.studyId,
        patientId: reports.patientId,
        templateName: reports.templateName,
        findings: reports.findings,
        impression: reports.impression,
        recommendation: reports.recommendation,
        status: reports.status,
        signedAt: reports.signedAt,
        createdAt: reports.createdAt,
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
        patientMrn: patients.mrn,
        radiologistFirstName: staff.firstName,
        radiologistLastName: staff.lastName,
      })
      .from(reports)
      .leftJoin(patients, eq(reports.patientId, patients.id))
      .leftJoin(staff, eq(reports.radiologistId, staff.id))
      .orderBy(desc(reports.createdAt));

    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch reports" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await db.insert(reports).values(body).returning();
    return NextResponse.json(result[0], { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create report" }, { status: 500 });
  }
}
