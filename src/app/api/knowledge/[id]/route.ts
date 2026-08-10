import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { knowledgeDocuments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { publishEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [doc] = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, id));
  if (!doc) return NextResponse.json({ error: "document not found" }, { status: 404 });
  return NextResponse.json({ ok: true, document: doc });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requireRoleOrFail } = await import("@/lib/auth/requireRole");
  const { error: authError } = await requireRoleOrFail(request as unknown as Request, ["administrator"]);
  if (authError) return authError;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const [doc] = await db
    .update(knowledgeDocuments)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(knowledgeDocuments.id, id))
    .returning();
  if (!doc) return NextResponse.json({ error: "document not found" }, { status: 404 });

  await recordAudit({
    action: "knowledge.document_updated",
    module: "knowledge",
    entityType: "knowledge_document",
    entityId: doc.id,
    details: { title: doc.title, status: doc.status },
  });
  if (body.status === "published") {
    await publishEvent({ type: "knowledge.published", aggregate: "knowledge", aggregateId: doc.id, payload: { title: doc.title } });
  }
  return NextResponse.json({ ok: true, document: doc });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { requireRoleOrFail } = await import("@/lib/auth/requireRole");
  const { error: delAuthError } = await requireRoleOrFail(_request as unknown as Request, ["administrator"]);
  if (delAuthError) return delAuthError;
  const { id } = await params;
  const [doc] = await db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.id, id)).returning();
  if (!doc) return NextResponse.json({ error: "document not found" }, { status: 404 });
  await recordAudit({
    action: "knowledge.document_deleted",
    module: "knowledge",
    entityType: "knowledge_document",
    entityId: id,
    details: { title: doc.title },
  });
  return NextResponse.json({ ok: true });
}
