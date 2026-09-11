// Inbound rate limiting for Timbre's own endpoints, as opposed to `@timbre/core`'s limiter,
// which paces what Timbre sends out. The threat is a stuck retry loop spending Apple's ~20
// requests/minute before a real reader types a letter, which fails invisibly: search goes
// quiet for everyone. Per instance and in memory — back-pressure, not an access control. No
// `server-only` guard: that import throws outside a server component, which would leave the
// counting logic untestable.

export interface RateLimitOptions {
  /** Sustained requests per window. */
  limit: number;
  windowMs: number;
  /** Cap on tracked clients, so unique addresses cannot grow the map forever. */
  max?: number;
  now?: () => number;
}

export interface RateLimitVerdict {
  ok: boolean;
  /** Requests left in this window. */
  remaining: number;
  /** Seconds until the window resets. For the `Retry-After` header. */
  retryAfterSeconds: number;
  /** On a refusal, whether it is this window's first. What a log wants: a stuck loop is one
   * event, and a line per request it sends would bury every other line under it. */
  first?: boolean;
}

interface Window {
  count: number;
  resetAt: number;
}

export interface RateLimiter {
  check(key: string): RateLimitVerdict;
  readonly size: number;
}

/** A limiter using a fixed window rather than a token bucket — the boundary burst is
 * acceptable because these counters are already approximate. */
export function createRateLimiter({
  limit,
  windowMs,
  max = 10_000,
  now = Date.now,
}: RateLimitOptions): RateLimiter {
  const windows = new Map<string, Window>();

  return {
    get size() {
      return windows.size;
    },

    check(key) {
      const at = now();
      const existing = windows.get(key);

      if (!existing || existing.resetAt <= at) {
        if (windows.size >= max) {
          // Sweep what has lapsed before evicting anything live.
          for (const [id, window] of windows) {
            if (window.resetAt <= at) windows.delete(id);
          }
          if (windows.size >= max) {
            const oldest = windows.keys().next();
            if (!oldest.done) windows.delete(oldest.value);
          }
        }
        windows.set(key, { count: 1, resetAt: at + windowMs });
        return { ok: true, remaining: limit - 1, retryAfterSeconds: 0 };
      }

      existing.count += 1;
      const remaining = Math.max(0, limit - existing.count);
      if (existing.count <= limit) return { ok: true, remaining, retryAfterSeconds: 0 };

      return {
        ok: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - at) / 1000)),
        first: existing.count === limit + 1,
      };
    },
  };
}

/** Who is asking. The client is the *first* entry of `x-forwarded-for` — the list is
 * appended to as it is relayed, so the last would key every visitor to the same proxy. */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
