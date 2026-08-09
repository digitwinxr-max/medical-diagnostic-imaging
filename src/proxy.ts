import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "geraldos_session";

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  const isProd = process.env.NODE_ENV === "production" || process.env.GERALDOS_ENV === "production";
  if (isProd) {
    if (!secret || secret.length < 32) throw new Error("AUTH_SECRET required in production");
    return new TextEncoder().encode(secret);
  }
  return new TextEncoder().encode(secret ?? "geraldos-dev-secret-change-me-not-for-production");
}

export async function proxy(request: NextRequest) {
  const isProd = process.env.NODE_ENV === "production" || process.env.GERALDOS_ENV === "production";
  // In production, fail closed if Keycloak is not configured — do not silently bypass.
  if (!process.env.KEYCLOAK_URL) {
    if (isProd) {
      // Allow only auth/health/webhooks to avoid lockout loop; otherwise 401
      const { pathname } = request.nextUrl;
      if (
        pathname.startsWith("/login") ||
        pathname.startsWith("/api/auth") ||
        pathname.startsWith("/api/health") ||
        pathname.startsWith("/_next") ||
        pathname === "/favicon.ico"
      ) {
        return NextResponse.next();
      }
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "authentication not configured" }, { status: 503 });
      }
      return NextResponse.redirect(new URL("/login?error=auth_not_configured", request.nextUrl.origin));
    }
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/api/webhooks") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      await jwtVerify(token, secretKey());
      return NextResponse.next();
    } catch {
      // invalid/expired token
    }
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.nextUrl.origin));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
