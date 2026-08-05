/**
 * Inbound rate limiting for Timbre's own endpoints.
 *
 * `@timbre/core`'s limiter paces what Timbre sends *out* to Deezer and Apple.
 * This is the other direction: what one client may ask *of Timbre*. They are
 * separate problems and conflating them is how a single script exhausts a
 * per-IP quota that everyone else is sharing.
 *
 * The threat is mundane rather than malicious — a stuck retry loop, a page left
 * open somewhere refreshing, someone curling search in a shell loop. Any of
 * them can spend Apple's ~20 requests/minute before a real reader types a
 * letter, and the failure is invisible: search simply goes quiet for everyone.
 *
 * **Per instance, in memory, and honest about it.** With no database there is
 * nowhere shared to keep counters, so a deployment on several instances gives
 * each its own allowance. That is a weaker guarantee than it looks and is not
 * an access-control mechanism — it is back-pressure, sized to stop accidents.
 *
 * No `server-only` guard: this holds no secrets, and that import throws outside
 * a server component, which would leave the counting logic untestable.
 */

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
}

interface Window {
  count: number;
  resetAt: number;
}

export interface RateLimiter {
  check(key: string): RateLimitVerdict;
  readonly size: number;
}

/**
 * A fixed window rather than a token bucket.
 *
 * Windows allow a burst at a boundary that a bucket would smooth, which for a
 * quota this small is the wrong trade in the abstract — but the counters here
 * are per instance and already approximate, and a window is one integer and a
 * timestamp against a bucket's continuous refill. Precision this cannot deliver
 * is not worth the machinery. `@timbre/core` has the real bucket for the
 * outbound side, where the limits are exact and the accounting has to be too.
 */
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
          // Sweep what has already lapsed before evicting anything live; under
          // normal traffic this reclaims the whole map and costs nothing.
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
      };
    },
  };
}

/**
 * Who is asking.
 *
 * Behind Vercel or Render the socket address is the proxy's, so the client is
 * the **first** entry of `x-forwarded-for` — the list is appended to as it is
 * relayed, and taking the last would key every visitor to the same proxy.
 *
 * A client can forge this header, which matters less than it sounds: forging it
 * spreads your own requests across buckets rather than anyone else's, and the
 * limit is back-pressure against accidents, not a security boundary. Falling
 * back to a single shared key would be worse — one bad client would then
 * throttle everybody.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
