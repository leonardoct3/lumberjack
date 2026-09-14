import { describe, expect, it } from "vitest";
import { assertAuthConfigured, authDisabled } from "@/auth/cookie";

describe("assertAuthConfigured", () => {
  it("is a no-op outside production", () => {
    expect(() =>
      assertAuthConfigured({
        NODE_ENV: "development",
        AUTH_DISABLED: "1",
        AUTH_PASSWORD: "changeme",
      }),
    ).not.toThrow();
  });

  it("rejects AUTH_DISABLED in production", () => {
    expect(() =>
      assertAuthConfigured({
        NODE_ENV: "production",
        AUTH_DISABLED: "1",
        AUTH_PASSWORD: "a-strong-password-here",
      }),
    ).toThrow(/AUTH_DISABLED/);
  });

  it("rejects empty, short, or default passwords in production", () => {
    for (const password of ["", "short", "changeme", "password", "lumberjack"]) {
      expect(() =>
        assertAuthConfigured({
          NODE_ENV: "production",
          AUTH_PASSWORD: password,
        }),
      ).toThrow(/AUTH_PASSWORD/);
    }
  });

  it("accepts a strong password in production", () => {
    expect(() =>
      assertAuthConfigured({
        NODE_ENV: "production",
        AUTH_PASSWORD: "a-strong-password-here",
      }),
    ).not.toThrow();
  });
});

describe("authDisabled still works for local", () => {
  it("reads AUTH_DISABLED=1", () => {
    const previous = process.env.AUTH_DISABLED;
    process.env.AUTH_DISABLED = "1";
    try {
      expect(authDisabled()).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.AUTH_DISABLED;
      else process.env.AUTH_DISABLED = previous;
    }
  });
});
