import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  COOKIE,
  authDisabled,
  isValidSession,
  makeSessionToken,
} from "@/auth/cookie";

const originalDisabled = process.env.AUTH_DISABLED;

afterEach(() => {
  if (originalDisabled === undefined) {
    delete process.env.AUTH_DISABLED;
  } else {
    process.env.AUTH_DISABLED = originalDisabled;
  }
});

describe("COOKIE", () => {
  it("is lumberjack_session", () => {
    expect(COOKIE).toBe("lumberjack_session");
  });
});

describe("authDisabled", () => {
  it("is true when AUTH_DISABLED is 1", () => {
    process.env.AUTH_DISABLED = "1";
    expect(authDisabled()).toBe(true);
  });

  it("is false when AUTH_DISABLED is not 1", () => {
    process.env.AUTH_DISABLED = "0";
    expect(authDisabled()).toBe(false);
    process.env.AUTH_DISABLED = "true";
    expect(authDisabled()).toBe(false);
    delete process.env.AUTH_DISABLED;
    expect(authDisabled()).toBe(false);
  });
});

describe("makeSessionToken", () => {
  it("is sha256(password:secret) hex", () => {
    const expected = createHash("sha256").update("pw:sec").digest("hex");
    expect(makeSessionToken("pw", "sec")).toBe(expected);
  });
});

describe("isValidSession", () => {
  const password = "opensecret";
  const secret = "opensecret";

  it("accepts a token minted for the password and secret", () => {
    const token = makeSessionToken(password, secret);
    expect(isValidSession(token, password, secret)).toBe(true);
  });

  it("rejects a token minted for a different password", () => {
    const token = makeSessionToken("wrong", secret);
    expect(isValidSession(token, password, secret)).toBe(false);
  });

  it("rejects an empty or missing token", () => {
    expect(isValidSession("", password, secret)).toBe(false);
    expect(isValidSession(undefined, password, secret)).toBe(false);
  });

  it("rejects empty password or secret", () => {
    const token = makeSessionToken(password, secret);
    expect(isValidSession(token, "", secret)).toBe(false);
    expect(isValidSession(token, password, "")).toBe(false);
    expect(isValidSession(token, "", "")).toBe(false);
  });
});

describe("makeSessionToken empty inputs", () => {
  it("throws when password or secret is empty", () => {
    expect(() => makeSessionToken("", "sec")).toThrow();
    expect(() => makeSessionToken("pw", "")).toThrow();
    expect(() => makeSessionToken("", "")).toThrow();
  });
});
