import { describe, expect, it } from "vitest";
import {
  LOGIN_MAX_ATTEMPTS,
  LOGIN_WINDOW_MS,
  checkLoginRateLimit,
  clearLoginRateLimit,
  clientIpFromHeaders,
} from "@/auth/rate-limit";

describe("checkLoginRateLimit", () => {
  it("allows the first attempts inside the window", () => {
    const store = new Map();
    const now = 1_000_000;
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      const result = checkLoginRateLimit("1.2.3.4", now + i, store);
      expect(result.ok).toBe(true);
    }
  });

  it("blocks after the max attempts until the window resets", () => {
    const store = new Map();
    const now = 1_000_000;
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      checkLoginRateLimit("9.9.9.9", now, store);
    }
    const blocked = checkLoginRateLimit("9.9.9.9", now + 1, store);
    expect(blocked).toEqual({
      ok: false,
      retryAfterMs: LOGIN_WINDOW_MS - 1,
    });

    const after = checkLoginRateLimit(
      "9.9.9.9",
      now + LOGIN_WINDOW_MS,
      store,
    );
    expect(after.ok).toBe(true);
  });

  it("tracks IPs independently and clears on success", () => {
    const store = new Map();
    const now = 1_000_000;
    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) {
      checkLoginRateLimit("a", now, store);
    }
    expect(checkLoginRateLimit("b", now, store).ok).toBe(true);
    clearLoginRateLimit("a", store);
    expect(checkLoginRateLimit("a", now + 1, store).ok).toBe(true);
  });
});

describe("clientIpFromHeaders", () => {
  it("prefers the first x-forwarded-for hop", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.1, 10.0.0.1",
      "x-real-ip": "10.0.0.1",
    });
    expect(clientIpFromHeaders(headers)).toBe("203.0.113.1");
  });

  it("falls back to x-real-ip then unknown", () => {
    expect(
      clientIpFromHeaders(new Headers({ "x-real-ip": "198.51.100.7" })),
    ).toBe("198.51.100.7");
    expect(clientIpFromHeaders(new Headers())).toBe("unknown");
  });
});
