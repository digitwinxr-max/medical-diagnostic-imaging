import type { SessionUser } from "./session";

export type ClinicalRole = "administrator" | "manager" | "radiologist" | "radiographer" | "receptionist" | "viewer";

export function hasRole(user: SessionUser | null, rolePattern: RegExp | string): boolean {
  if (!user) return false;
  const roles = user.roles ?? [];
  if (typeof rolePattern === "string") return roles.includes(rolePattern);
  return roles.some((r) => rolePattern.test(r));
}

export function isRadiologist(user: SessionUser | null): boolean {
  return hasRole(user, /radiolog/i);
}

export function isPrivileged(user: SessionUser | null): boolean {
  if (!user) return false;
  return hasRole(user, /administrator/i) || hasRole(user, /manager/i) || isRadiologist(user);
}

/**
 * Central authorization check for clinical operations.
 * Returns true if user has any of the required roles.
 * Administrator always passes.
 */
export function authorize(user: SessionUser | null, required: ClinicalRole[]): boolean {
  if (!user) return false;
  if (hasRole(user, "administrator")) return true;
  return required.some((r) => {
    if (r === "radiologist") return isRadiologist(user);
    return hasRole(user, r);
  });
}
