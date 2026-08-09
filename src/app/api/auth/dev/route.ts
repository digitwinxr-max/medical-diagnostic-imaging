import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth/session";
import { keycloakConfigured } from "@/lib/auth/oidc";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * Dev sign-in: issues a local administrator session when Keycloak is not
 * wired up (or when DEV_AUTH=true). Keeps the platform demoable in degraded mode.
 */
export async function GET(request: NextRequest) {
  const isProd = process.env.NODE_ENV === "production" || process.env.GERALDOS_ENV === "production";
  if (isProd) {
    return NextResponse.redirect(new URL("/login?error=dev_auth_disabled", request.nextUrl.origin));
  }
  const allowDev = !keycloakConfigured() || process.env.DEV_AUTH === "true";
  if (!allowDev) {
    return NextResponse.redirect(new URL("/login?error=dev_auth_disabled", request.nextUrl.origin));
  }

  const token = await createSessionToken({
    sub: "dev-admin",
    name: "Gerald Holdings Admin",
    email: "admin@gerald.co.za",
    roles: ["administrator", "radiologist", "radiographer", "receptionist", "manager"],
    iss: "geraldos-dev",
  });

  await recordAudit({
    userId: "dev-admin",
    action: "auth.login",
    module: "auth",
    details: { name: "Gerald Holdings Admin", via: "dev" },
  });

  const res = NextResponse.redirect(new URL("/", request.nextUrl.origin));
  const { sessionCookieOptions } = await import("@/lib/auth/session");
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
}
