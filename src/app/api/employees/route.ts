import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { employeeRecords, staff, branches } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { generateEmployeeNumber } from "@/lib/finance";

export async function GET() {
  try {
    const result = await db
      .select({
        id: employeeRecords.id,
        employeeNumber: employeeRecords.employeeNumber,
        department: employeeRecords.department,
        employmentType: employeeRecords.employmentType,
        startDate: employeeRecords.startDate,
        monthlySalary: employeeRecords.monthlySalary,
        hourlyRate: employeeRecords.hourlyRate,
        status: employeeRecords.status,
        staffFirstName: staff.firstName,
        staffLastName: staff.lastName,
        staffRole: staff.role,
        staffEmail: staff.email,
        branchName: branches.name,
      })
      .from(employeeRecords)
      .leftJoin(staff, eq(employeeRecords.staffId, staff.id))
      .leftJoin(branches, eq(employeeRecords.branchId, branches.id))
      .orderBy(desc(employeeRecords.createdAt));

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch employees" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
    const { requireRoleOrFail } = await import("@/lib/auth/requireRole");
  const { error: authError } = await requireRoleOrFail(request as unknown as Request, ["administrator"]);
  if (authError) return authError;
try {
    const body = await request.json();
    const result = await db
      .insert(employeeRecords)
      .values({
        staffId: body.staffId,
        employeeNumber: generateEmployeeNumber(),
        department: body.department ?? null,
        employmentType: body.employmentType ?? "full_time",
        branchId: body.branchId ?? null,
        startDate: body.startDate ?? new Date().toISOString().split("T")[0],
        hourlyRate: body.hourlyRate ?? null,
        monthlySalary: body.monthlySalary ?? null,
      })
      .returning();
    return NextResponse.json(result[0], { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create employee record", detail: String(error) }, { status: 500 });
  }
}
