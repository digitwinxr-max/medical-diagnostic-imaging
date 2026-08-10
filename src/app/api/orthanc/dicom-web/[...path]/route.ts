import { NextRequest } from "next/server";
import { integrationConfig, orthancAuthHeader } from "@/lib/integrations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * /api/orthanc/dicom-web/[...path] — same-origin DICOMweb pass-through.
 *
 * OHIF points its qido/wado/stow roots at this route, so the browser talks to
 * the Next.js origin only (no CORS needed) and Orthanc credentials never leave
 * the server. Supports QIDO-RS (GET studies/series/instances), WADO-RS (GET
 * instances/frames, multipart/related) and STOW-RS (POST/upload).
 */
async function proxy(request: NextRequest, segments: string[]) {
  const { url } = integrationConfig.orthanc;
  if (!url) {
    return new Response(JSON.stringify({ error: "Orthanc is not configured (ORTHANC_URL)" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }

  // Sanitise: reject traversal / path escapes; forward only DICOMweb segments.
  const safe = segments
    .map((s) => encodeURIComponent(s.replace(/^\/|\/$/g, "")))
    .filter(Boolean)
    .join("/");
  if (segments.some((s) => s.includes("..") || s.includes("\\"))) {
    return new Response(JSON.stringify({ error: "invalid proxy path" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const upstream = `${url.replace(/\/$/, "")}/dicom-web/${safe}${request.nextUrl.search}`;

  const headers: Record<string, string> = { ...(orthancAuthHeader() as Record<string, string>) };
  const accept = request.headers.get("accept");
  const contentType = request.headers.get("content-type");
  if (accept) headers.accept = accept;
  if (contentType) headers["content-type"] = contentType;

  let body: BodyInit | null = null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.arrayBuffer();
  }

  try {
    const res = await fetch(upstream, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    const buffer = await res.arrayBuffer();
    // CORS is restricted to the configured application origin + OHIF origin
    // (same-origin is sufficient for workstation iframe; wildcard is removed)
    const requestOrigin = request.headers.get("origin");
    const allowedOrigins = [
      process.env.NEXT_PUBLIC_APP_URL,
      "http://localhost:3000",
      "http://localhost:3001",
    ].filter(Boolean) as string[];
    const allowOrigin = requestOrigin && allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0];
    const corsHeaders: Record<string, string> = {
      "content-type": res.headers.get("content-type") ?? "application/json",
    };
    if (allowOrigin) corsHeaders["access-control-allow-origin"] = allowOrigin;
    // Only set Vary when CORS is used
    if (allowOrigin) corsHeaders["vary"] = "Origin";
    return new Response(buffer, {
      status: res.status,
      headers: corsHeaders,
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Orthanc unreachable", detail: error instanceof Error ? error.message : String(error) }),
      { status: 502, headers: { "content-type": "application/json" } }
    );
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxy(request, path ?? []);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxy(request, path ?? []);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxy(request, path ?? []);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxy(request, path ?? []);
}

export async function OPTIONS(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  await params;
  const requestOrigin = request.headers.get("origin");
  const allowedOrigins = [
    process.env.NEXT_PUBLIC_APP_URL,
    "http://localhost:3000",
    "http://localhost:3001",
  ].filter(Boolean) as string[];
  const allowOrigin = requestOrigin && allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0] ?? "";
  const headers: Record<string, string> = {
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, accept, authorization",
  };
  if (allowOrigin) {
    headers["access-control-allow-origin"] = allowOrigin;
    headers["vary"] = "Origin";
  }
  return new Response(null, {
    status: 204,
    headers,
  });
}
