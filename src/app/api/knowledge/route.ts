import { NextRequest, NextResponse } from "next/server";
import { searchKnowledge } from "@/lib/knowledge";
import { db } from "@/db";
import { knowledgeDocuments } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { publishEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

/** GET /api/knowledge?q=ct+protocol&category=protocol&includeAll=1 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const category = request.nextUrl.searchParams.get("category") ?? undefined;
  const includeAll = request.nextUrl.searchParams.get("includeAll") === "1";
  try {
    if (includeAll && !q) {
      // Include drafts/archived for the editor view.
      const all = await db.select().from(knowledgeDocuments).orderBy(knowledgeDocuments.updatedAt);
      return NextResponse.json({ ok: true, documents: all });
    }
    const documents = await searchKnowledge(q, { category });
    return NextResponse.json({ ok: true, documents });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "failed to search knowledge", detail: String(error) }, { status: 500 });
  }
}

/** POST /api/knowledge { title, category, docType, content, summary, tags, version, author } */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body?.title || !body?.category || !body?.content) {
    return NextResponse.json({ error: "title, category and content are required" }, { status: 400 });
  }
    const { requireRoleOrFail } = await import("@/lib/auth/requireRole");
  const { error: authError } = await requireRoleOrFail(request as unknown as Request, ["administrator"]);
  if (authError) return authError;
try {
    const [doc] = await db
      .insert(knowledgeDocuments)
      .values({
        title: body.title,
        category: body.category,
        docType: body.docType ?? "guide",
        summary: body.summary ?? null,
        content: body.content,
        tags: Array.isArray(body.tags) ? body.tags : [],
        version: body.version ?? "1.0",
        author: body.author ?? null,
        status: body.status ?? "published",
        approvedBy: body.approvedBy ?? null,
      })
      .returning();

    await recordAudit({
      action: "knowledge.document_created",
      module: "knowledge",
      entityType: "knowledge_document",
      entityId: doc.id,
      details: { title: doc.title, category: doc.category },
    });
    if (doc.status === "published") {
      await publishEvent({ type: "knowledge.published", aggregate: "knowledge", aggregateId: doc.id, payload: { title: doc.title } });
    }
    return NextResponse.json({ ok: true, document: doc }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "failed to create document", detail: String(error) }, { status: 500 });
  }
}
