export function createRateLimiter({
  limit,
  windowMs,
  max = 10_000,
  now = Date.now,
}: {
  limit: number;
  windowMs: number;
  max?: number;
  now?: () => number;
}) {
  const windows = new Map<string, { count: number; resetAt: number }>();

  return {
    get size() {
      return windows.size;
    },

    check(key: string) {
      const at = now();
      const existing = windows.get(key);

      if (!existing || existing.resetAt <= at) {
        if (windows.size >= max) {
          for (const [id, window] of windows) {
            if (window.resetAt <= at) windows.delete(id);
          }
          if (windows.size >= max) windows.delete(windows.keys().next().value!);
        }
        windows.set(key, { count: 1, resetAt: at + windowMs });
        return { ok: true, remaining: limit - 1, retryAfterSeconds: 0 };
      }

      existing.count += 1;
      const remaining = limit - existing.count;
      if (remaining >= 0) return { ok: true, remaining, retryAfterSeconds: 0 };

      return {
        ok: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - at) / 1000)),
        first: existing.count === limit + 1,
      };
    },
  };
}

// `x-forwarded-for` is whatever the caller sent unless something in front overwrites it, so
// on a host that does not, a rotating value gives every request its own bucket and the
// limiter stops existing. Vercel does overwrite it — and separately sets
// `x-vercel-forwarded-for`, which it never forwards from the caller — so read the headers a
// proxy owns first and fall back to `x-forwarded-for` only when neither is present. That
// keeps Vercel exactly as it was and makes the Dockerfile's deployment the weaker case
// rather than the free one.
const PROXY_OWNED = ["x-vercel-forwarded-for", "x-real-ip"] as const;

export function clientKey(request: Request): string {
  for (const header of PROXY_OWNED) {
    const value = request.headers.get(header)?.trim();
    if (value) return value;
  }
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
