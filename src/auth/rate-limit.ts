/** Fixed window: this many failed attempts before the IP is locked out. */
export const LOGIN_MAX_ATTEMPTS = 10;

/** Window length for the attempt counter. */
export const LOGIN_WINDOW_MS = 10 * 60 * 1000;

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitDecision =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterMs: number };

/** Pure enough for tests: pass `now` and optionally an isolated map. */
export function checkLoginRateLimit(
  ip: string,
  now: number,
  store: Map<string, Bucket> = buckets,
): RateLimitDecision {
  const key = ip || "unknown";
  const existing = store.get(key);

  if (!existing || now >= existing.resetAt) {
    store.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return { ok: true, remaining: LOGIN_MAX_ATTEMPTS - 1 };
  }

  if (existing.count >= LOGIN_MAX_ATTEMPTS) {
    return { ok: false, retryAfterMs: existing.resetAt - now };
  }

  existing.count += 1;
  return { ok: true, remaining: LOGIN_MAX_ATTEMPTS - existing.count };
}

export function clearLoginRateLimit(
  ip: string,
  store: Map<string, Bucket> = buckets,
): void {
  store.delete(ip || "unknown");
}

/** First hop in `x-forwarded-for`, which Railway's edge proxy fills. */
export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}
