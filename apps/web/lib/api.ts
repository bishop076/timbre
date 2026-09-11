import "server-only";

import type { z } from "zod";

import { createCache } from "./cache";
import { log, scrub } from "./log";
import { clientKey, createRateLimiter } from "./rate-limit";

const globalForApi = globalThis as unknown as {
  __timbreResponseCache?: ReturnType<typeof createCache<unknown>>;
  __timbreLimiters?: Record<string, ReturnType<typeof createRateLimiter>>;
};

const PER_MINUTE = { api: 60, artwork: 300, health: 30 };

export function guard(request: Request, budget: keyof typeof PER_MINUTE = "api"): Response | null {
  const limiters = (globalForApi.__timbreLimiters ??= {});
  const limiter = (limiters[budget] ??= createRateLimiter({
    limit: PER_MINUTE[budget],
    windowMs: 60_000,
  }));

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
      headers: { "Retry-After": String(verdict.retryAfterSeconds), "Cache-Control": "no-store" },
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

export function queryRoute<S extends z.ZodObject>(
  schema: S,
  invalid: string,
  handle: (query: z.output<S>, request: Request) => Promise<Response>,
  { issues = false } = {},
) {
  return async (request: Request): Promise<Response> => {
    const refusal = guard(request);
    if (refusal) return refusal;

    const params = new URL(request.url).searchParams;
    const query = Object.keys(schema.shape).map((key) => [key, params.get(key) ?? undefined]);
    const parsed = schema.safeParse(Object.fromEntries(query));
    if (parsed.success) return handle(parsed.data, request);

    return Response.json(
      issues ? { error: invalid, issues: parsed.error.issues } : { error: invalid },
      { status: 400 },
    );
  };
}

export function cached<T>(key: string, produce: () => Promise<T>): Promise<T> {
  globalForApi.__timbreResponseCache ??= createCache<unknown>({ ttlMs: 120_000, max: 500 });
  return globalForApi.__timbreResponseCache.take(key, produce) as Promise<T>;
}

export function json(body: unknown, cacheControl: string): Response {
  return Response.json(body, { headers: { "cache-control": cacheControl } });
}

export const CACHE_CONTROL_HOUR = "public, s-maxage=3600, stale-while-revalidate=86400";

export const CACHE_CONTROL_DAY = "public, s-maxage=86400, stale-while-revalidate=604800";
