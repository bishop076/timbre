import "server-only";

import { createCache } from "./cache";
import { log, scrub } from "./log";
import { clientKey, createRateLimiter } from "./rate-limit";

const globalForApi = globalThis as unknown as {
  __timbreResponseCache?: ReturnType<typeof createCache<unknown>>;
  __timbreInboundLimiter?: ReturnType<typeof createRateLimiter>;
  __timbreArtworkLimiter?: ReturnType<typeof createRateLimiter>;
  __timbreHealthLimiter?: ReturnType<typeof createRateLimiter>;
};

const CACHE_TTL_MS = 120_000;

const CACHE_MAX_ENTRIES = 500;

const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

const ARTWORK_RATE_LIMIT = 300;

const HEALTH_RATE_LIMIT = 30;

function responseCache() {
  return (globalForApi.__timbreResponseCache ??= createCache<unknown>({
    ttlMs: CACHE_TTL_MS,
    max: CACHE_MAX_ENTRIES,
  }));
}

function inboundLimiter() {
  return (globalForApi.__timbreInboundLimiter ??= createRateLimiter({
    limit: RATE_LIMIT,
    windowMs: RATE_WINDOW_MS,
  }));
}

export function guard(request: Request): Response | null {
  return meter(request, "api", inboundLimiter());
}

export function guardArtwork(request: Request): Response | null {
  return meter(
    request,
    "artwork",
    (globalForApi.__timbreArtworkLimiter ??= createRateLimiter({
      limit: ARTWORK_RATE_LIMIT,
      windowMs: RATE_WINDOW_MS,
    })),
  );
}

export function guardHealth(request: Request): Response | null {
  return meter(
    request,
    "health",
    (globalForApi.__timbreHealthLimiter ??= createRateLimiter({
      limit: HEALTH_RATE_LIMIT,
      windowMs: RATE_WINDOW_MS,
    })),
  );
}

function meter(
  request: Request,
  budget: "api" | "artwork" | "health",
  limiter: ReturnType<typeof createRateLimiter>,
): Response | null {
  const verdict = limiter.check(clientKey(request));
  if (verdict.ok) return null;

  if (verdict.first) {
    log("warn", "rate_limited", {
      route: new URL(request.url).pathname,
      budget,
      retryAfterSeconds: verdict.retryAfterSeconds,
    });
  }

  return Response.json(
    { error: "Too many requests. Slow down and try again shortly." },
    {
      status: 429,
      headers: {
        "Retry-After": String(verdict.retryAfterSeconds),
        "Cache-Control": "no-store",
      },
    },
  );
}

export function reportFailures(
  route: string,
  failures: readonly { source: string; message: string }[],
): void {
  for (const failure of failures) {
    log("warn", "upstream_failed", { route, source: failure.source, message: scrub(failure.message) });
  }
}

export function cached<T>(key: string, produce: () => Promise<T>): Promise<T> {
  return responseCache().take(key, produce as () => Promise<unknown>) as Promise<T>;
}

export const CACHE_CONTROL_HOUR = "public, s-maxage=3600, stale-while-revalidate=86400";

export const CACHE_CONTROL_DAY = "public, s-maxage=86400, stale-while-revalidate=604800";
