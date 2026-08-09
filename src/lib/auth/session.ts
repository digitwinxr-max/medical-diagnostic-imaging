import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "geraldos_session";

export interface SessionUser {
  sub: string;
  name: string;
  email?: string;
  roles: string[];
  iss: string;
}

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  const isProd = process.env.NODE_ENV === "production" || process.env.GERALDOS_ENV === "production";
  if (isProd) {
    if (!secret || secret.length < 32) {
      throw new Error("AUTH_SECRET must be at least 32 characters in production");
    }
    return new TextEncoder().encode(secret);
  }
  return new TextEncoder().encode(secret ?? "geraldos-dev-secret-change-me-not-for-production");
}

export function sessionCookieOptions() {
  const isProd = process.env.NODE_ENV === "production" || process.env.GERALDOS_ENV === "production";
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    path: "/" as const,
    secure: isProd,
    maxAge: 60 * 60 * 8,
  };
}

export async function createSessionToken(user: SessionUser, maxAgeSec = 60 * 60 * 8): Promise<string> {
  return new SignJWT({
    name: user.name,
    email: user.email ?? null,
    roles: user.roles,
    iss: user.iss,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.sub)
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSec}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return {
      sub: payload.sub ?? "",
      name: (payload.name as string) ?? "Unknown User",
      email: (payload.email as string) ?? undefined,
      roles: (payload.roles as string[]) ?? [],
      iss: (payload.iss as string) ?? "geraldos",
    };
  } catch {
    return null;
  }
}
