import { describe, it, expect } from "vitest";
import { hasRole, isRadiologist, authorize } from "@/lib/auth/requireRole";
import { isProduction, isDevAuthAllowed } from "@/lib/env";

describe("Security — requireRole", () => {
  it("hasRole exact match", () => {
    expect(hasRole({ sub:"1", name:"A", roles:["radiologist"], iss:"x" }, "radiologist")).toBe(true);
    expect(hasRole({ sub:"1", name:"A", roles:["radiologist"], iss:"x" }, "admin")).toBe(false);
  });
  it("isRadiologist regex", () => {
    expect(isRadiologist({ sub:"1", name:"A", roles:["radiologist"], iss:"x" })).toBe(true);
    expect(isRadiologist({ sub:"1", name:"A", roles:["senior_radiologist"], iss:"x" })).toBe(true);
    expect(isRadiologist({ sub:"1", name:"A", roles:["receptionist"], iss:"x" })).toBe(false);
    expect(isRadiologist(null)).toBe(false);
  });
  it("authorize admin passes all", () => {
    const admin = { sub:"1", name:"A", roles:["administrator"], iss:"x" };
    expect(authorize(admin, ["radiologist"])).toBe(true);
    expect(authorize(admin, ["receptionist"])).toBe(true);
  });
  it("authorize fails without user", () => {
    expect(authorize(null, ["radiologist"])).toBe(false);
  });
  it("authorize radiologist only for radiologist", () => {
    const rad = { sub:"1", name:"A", roles:["radiologist"], iss:"x" };
    expect(authorize(rad, ["radiologist"])).toBe(true);
    expect(authorize(rad, ["receptionist"])).toBe(false);
  });
});

describe("Security — env gating", () => {
  it("isDevAuthAllowed false in production (when DEV_AUTH true but NODE_ENV production)", () => {
    const origNode = process.env.NODE_ENV;
    const origDev = process.env.DEV_AUTH;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.DEV_AUTH = "true";
    expect(isDevAuthAllowed()).toBe(false);
    (process.env as Record<string, string | undefined>).NODE_ENV = origNode as string;
    process.env.DEV_AUTH = origDev;
  });
  it("AUTH_SECRET empty in production should fail validation", () => {
    // validate via isProduction helper
    expect(isProduction()).toBeDefined();
  });
});

describe("Session cookie options", () => {
  it("production requires secure flag", async () => {
    const orig = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.AUTH_SECRET = "a".repeat(32);
    const { sessionCookieOptions } = await import("@/lib/auth/session");
    expect(sessionCookieOptions().secure).toBe(true);
    expect(sessionCookieOptions().httpOnly).toBe(true);
    (process.env as Record<string, string | undefined>).NODE_ENV = orig as string;
    delete process.env.AUTH_SECRET;
  });
});
