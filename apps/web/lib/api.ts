import "server-only";

import { ProviderError } from "@timbre/core";
import type { z } from "zod";

import { createCache } from "./cache";
import { deezerRefusal } from "./deezer";
import { describeError, log, scrub } from "./log";
import { clientKey, createRateLimiter } from "./rate-limit";

const globalForApi = globalThis as unknown as {
  __timbreResponseCache?: ReturnType<typeof createCache<unknown>>;
  __timbreLimiters?: Record<string, ReturnType<typeof createRateLimiter>>;
};

const PER_MINUTE = { api: 60, pages: 120, artwork: 300, health: 30, reports: 20 };

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

/**
 * The floor under every route: nothing gets out of here uncaught.
 *
 * `queryRoute` had no `try` at all, so whatever a handler threw went to the platform, and the
 * platform's answer is a **500 with an empty body, no `content-type` and no `cache-control`** —
 * measured on a production build, with a Deezer that was answering 200 the whole time. Nine
 * routes stand on this wrapper; five of them have no `catch` of their own. A 500 says Timbre
 * broke, and the ones that are not that had already been fixed one route at a time — `/api/art`,
 * `/api/artist`, `/api/taste`, `/api/lyrics`, `/api/resolve`, `/api/spotify/search` all map a
 * refusal to 502 + `no-store`. This is the same answer, given once, under all of them.
 *
 * The two kinds it can name are named. `DeezerUnavailable` goes through `deezerRefusal` so the
 * wording stays the one wording. A `ProviderError` is only an outage when it says so:
 * `resolveUrl` draws exactly this line, because a provider handed a link that is not its own
 * declines with an error too, and calling that an outage is worse than the confusion it fixes.
 *
 * Anything else genuinely is Timbre broken, and stays a 500 — but a said 500, with a reason and
 * `no-store` on it. Catching it here is also the last place `instrumentation.ts` would have seen
 * it, so it is logged with the same `describeError` fields `onRequestError` writes.
 */
function routeFailed(route: string, error: unknown): Response {
  const refusal = deezerRefusal(error);
  if (refusal) return refusal;

  const outage =
    error instanceof ProviderError && (error.kind === "rate_limited" || error.kind === "transient")
      ? error
      : null;
  log(outage ? "warn" : "error", "route_failed", { route, ...describeError(error) });

  // Which source, and nothing else — `publicFailures` above says why the message itself never
  // goes out.
  return outage
    ? Response.json(
        {
          error: "The service behind this wouldn't answer for it just now. Try again shortly.",
          source: outage.provider,
        },
        { status: 502, headers: { "cache-control": "no-store" } },
      )
    : Response.json(
        { error: "Timbre broke while answering this. Try again shortly." },
        { status: 500, headers: { "cache-control": "no-store" } },
      );
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

    const { pathname, searchParams } = new URL(request.url);
    const query = Object.keys(schema.shape).map((key) => [key, searchParams.get(key) ?? undefined]);
    const parsed = schema.safeParse(Object.fromEntries(query));
    if (!parsed.success) {
      return Response.json(
        issues ? { error: invalid, issues: parsed.error.issues } : { error: invalid },
        { status: 400 },
      );
    }

    try {
      return await handle(parsed.data, request);
    } catch (error) {
      return routeFailed(pathname, error);
    }
  };
}

/** How long a merged answer is held in process. Exported so a route's header cannot drift from it. */
export const RESPONSE_CACHE_TTL_MS = 120_000;

export function cached<T>(
  key: string,
  produce: () => Promise<T>,
  keep?: (value: T) => boolean,
): Promise<T> {
  globalForApi.__timbreResponseCache ??= createCache<unknown>({
    ttlMs: RESPONSE_CACHE_TTL_MS,
    max: 500,
  });
  return globalForApi.__timbreResponseCache.take(
    key,
    produce,
    keep as ((value: unknown) => boolean) | undefined,
  ) as Promise<T>;
}

/** A body worth caching is one no provider failed to contribute to. */
export const whole = (body: { failures?: unknown[] }): boolean => !body.failures?.length;

/**
 * What a reader is allowed to know about a failure: which source, and nothing else.
 *
 * The messages are upstream text — `providers/src/deezer.ts` puts Deezer's own `error.message`
 * straight into one, and the requester's carry hostnames and status codes. Every log path
 * scrubs through `scrub()` before writing them down, and then the same strings were handed to
 * the browser verbatim. Nothing on the client has ever read `.message`: the one consumer,
 * `artist-view.tsx`, tests `failures.length`. So this costs nothing and closes it.
 */
export const publicFailures = (
  failures: readonly { source: string; message: string }[],
): { source: string }[] => failures.map(({ source }) => ({ source }));

export function json(body: unknown, cacheControl: string): Response {
  return Response.json(body, { headers: { "cache-control": cacheControl } });
}

export const CACHE_CONTROL_HOUR = "public, s-maxage=3600, stale-while-revalidate=86400";

export const CACHE_CONTROL_DAY = "public, s-maxage=86400, stale-while-revalidate=604800";
