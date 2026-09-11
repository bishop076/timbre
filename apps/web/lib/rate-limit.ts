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

export function clientKey(request: Request): string {
  const first = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip")?.trim() || "unknown";
}
