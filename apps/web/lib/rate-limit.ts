export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  max?: number;
  now?: () => number;
}

export interface RateLimitVerdict {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
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

export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
