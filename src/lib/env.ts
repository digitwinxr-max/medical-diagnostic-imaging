/**
 * GeraldOS environment validation — production security boundary.
 * Fails closed when required secrets/config absent in production.
 */

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production" || process.env.GERALDOS_ENV === "production";
}

export function isDevAuthAllowed(): boolean {
  // DEV_AUTH only honored in non-production
  if (isProduction()) return false;
  return process.env.DEV_AUTH === "true";
}

export function validateAuthSecret(): void {
  const secret = process.env.AUTH_SECRET;
  if (isProduction()) {
    if (!secret || secret.length < 32) {
      throw new Error(
        "AUTH_SECRET must be set to at least 32 characters in production. Refusing to start."
      );
    }
  }
}

export function requireKeycloakInProduction(): void {
  if (isProduction() && !process.env.KEYCLOAK_URL) {
    throw new Error("KEYCLOAK_URL is required in production. Refusing degraded auth.");
  }
}
