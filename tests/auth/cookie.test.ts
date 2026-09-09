import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  COOKIE,
  SESSION_MAX_AGE_SECONDS,
  authDisabled,
  isValidSession,
  makeSessionToken,
  matchesSecret,
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

describe("SESSION_MAX_AGE_SECONDS", () => {
  it("is seven days", () => {
    expect(SESSION_MAX_AGE_SECONDS).toBe(7 * 24 * 60 * 60);
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
  it("is the expiry joined to sha256(secret:expiry)", () => {
    const expiresAt = 1_800_000_000_000;
    const signature = createHash("sha256")
      .update(`sec:${expiresAt}`)
      .digest("hex");
    expect(makeSessionToken("sec", expiresAt)).toBe(`${expiresAt}.${signature}`);
  });

  it("throws when the secret is empty", () => {
    expect(() => makeSessionToken("", 1_800_000_000_000)).toThrow();
  });

  it("throws when the expiry is not a positive integer", () => {
    expect(() => makeSessionToken("sec", 0)).toThrow();
    expect(() => makeSessionToken("sec", -1)).toThrow();
    expect(() => makeSessionToken("sec", 1.5)).toThrow();
    expect(() => makeSessionToken("sec", Number.NaN)).toThrow();
  });
});

describe("matchesSecret", () => {
  it("accepts the exact secret", () => {
    expect(matchesSecret("opensecret", "opensecret")).toBe(true);
  });

  it("rejects a wrong secret, including a prefix of it", () => {
    expect(matchesSecret("opensecre", "opensecret")).toBe(false);
    expect(matchesSecret("opensecret!", "opensecret")).toBe(false);
    expect(matchesSecret("OPENSECRET", "opensecret")).toBe(false);
  });

  it("rejects when either side is empty", () => {
    expect(matchesSecret("", "opensecret")).toBe(false);
    expect(matchesSecret("opensecret", "")).toBe(false);
    expect(matchesSecret("", "")).toBe(false);
  });
});

describe("isValidSession", () => {
  const secret = "opensecret";
  const now = 1_700_000_000_000;
  const expiresAt = now + 1000;

  it("accepts a token minted for the secret before it expires", () => {
    const token = makeSessionToken(secret, expiresAt);
    expect(isValidSession(token, secret, now)).toBe(true);
  });

  it("rejects the token once the expiry is reached", () => {
    const token = makeSessionToken(secret, expiresAt);
    expect(isValidSession(token, secret, expiresAt)).toBe(false);
    expect(isValidSession(token, secret, expiresAt + 1)).toBe(false);
  });

  it("rejects a token minted for a different secret", () => {
    const token = makeSessionToken("other", expiresAt);
    expect(isValidSession(token, secret, now)).toBe(false);
  });

  it("rejects a token whose expiry was extended by hand", () => {
    const token = makeSessionToken(secret, expiresAt);
    const signature = token.split(".")[1];
    const forged = `${expiresAt + 60_000}.${signature}`;
    expect(isValidSession(forged, secret, expiresAt + 30_000)).toBe(false);
  });

  it("rejects an empty or missing token", () => {
    expect(isValidSession("", secret, now)).toBe(false);
    expect(isValidSession(undefined, secret, now)).toBe(false);
  });

  it("rejects a malformed token", () => {
    const signature = makeSessionToken(secret, expiresAt).split(".")[1];
    expect(isValidSession(signature, secret, now)).toBe(false);
    expect(isValidSession(String(expiresAt), secret, now)).toBe(false);
    expect(isValidSession(`abc.${signature}`, secret, now)).toBe(false);
    expect(isValidSession(`${expiresAt}.short`, secret, now)).toBe(false);
    expect(isValidSession(`${expiresAt}.${signature}.x`, secret, now)).toBe(
      false,
    );
  });

  it("rejects an empty secret", () => {
    const token = makeSessionToken(secret, expiresAt);
    expect(isValidSession(token, "", now)).toBe(false);
  });
});
