import { NextRequest, NextResponse } from "next/server";
import {
  discoverOidc,
  exchangeCodeForTokens,
  verifyIdToken,
  extractRoles,
} from "@/lib/auth/oidc";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const savedState = request.cookies.get("geraldos_oauth_state")?.value;

  if (!code || !state || !savedState || state !== savedState) {
    return NextResponse.redirect(new URL("/login?error=invalid_oauth_state", origin));
  }

  try {
    const oidc = await discoverOidc();
    const redirectUri = `${origin}/api/auth/callback`;
    const tokens = await exchangeCodeForTokens(oidc, code, redirectUri);
    const claims = await verifyIdToken(oidc, tokens.id_token);
    const roles = extractRoles(claims);
    const name = claims.name ?? claims.preferred_username ?? "Keycloak User";

    const sessionToken = await createSessionToken({
      sub: claims.sub,
      name,
      email: claims.email,
      roles,
      iss: "keycloak",
    });

    await recordAudit({
      userId: claims.sub,
      action: "auth.login",
      module: "auth",
      details: { name, roles, via: "keycloak" },
    });

    const res = NextResponse.redirect(new URL("/", origin));
    res.cookies.set(SESSION_COOKIE, sessionToken, sessionCookieOptions());
    res.cookies.delete("geraldos_oauth_state");
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : "token_exchange_failed";
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, origin));
  }
}
