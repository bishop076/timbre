import "server-only";

import { createCache } from "./cache";
import { clientKey, createRateLimiter } from "./rate-limit";

/**
 * Shared back-pressure for Timbre's public API routes. Both structures are cached on
 * `globalThis`, since Next re-evaluates modules on every hot reload and a counter rebuilt
 * per edit remembers nothing. Routes are unauthenticated, so the client's address is the
 * only thing to meter on; the reason to meter is that the tightest limit belongs to
 * somebody else — Apple allows ~20 requests/minute per IP, and every visitor shares this
 * deployment's one outbound address.
 */

const globalForApi = globalThis as unknown as {
  __timbreResponseCache?: ReturnType<typeof createCache<unknown>>;
  __timbreInboundLimiter?: ReturnType<typeof createRateLimiter>;
  __timbreArtworkLimiter?: ReturnType<typeof createRateLimiter>;
};

/** Two minutes: absorbs a debounced search box and a room looking up the same song. */
const CACHE_TTL_MS = 120_000;

/** Roughly a few hundred distinct queries — a few MB at most. */
const CACHE_MAX_ENTRIES = 500;

/** 60/minute/client — above a person, below a retry loop. Sized to stop accidents, not
 * attacks; see `rate-limit.ts` for why it cannot be the latter without shared state. */
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

/**
 * 300/minute/client, for `/api/art` alone.
 *
 * Artwork cannot share the number above. A page renders on the order of thirty covers, so
 * an API-sized limit would refuse an ordinary Explore visit — and a 429 there is not a
 * retry, it is a broken picture on a page that was otherwise fine. Ten pages a minute is
 * still far above a person and far below anything walking the CDNs.
 *
 * The route had no limit at all, which made it the cheapest way to spend the deployment's
 * origin transfer: the allowlist bounds *which* hosts can be reached, not how often. See
 * docs/EXPOSURE.md, E-7.
 */
const ARTWORK_RATE_LIMIT = 300;

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

/** Metered access: a `429` to return from the handler, or `null` to carry on. The refusal
 * carries `Retry-After` because a client that does not know when to come back comes back
 * immediately, turning a throttle into the hot loop it was meant to stop. */
export function guard(request: Request): Response | null {
  return meter(request, inboundLimiter());
}

/** The same, on artwork's own budget. Kept apart so a burst of covers cannot spend the
 * allowance search needs, and vice versa. */
export function guardArtwork(request: Request): Response | null {
  return meter(
    request,
    (globalForApi.__timbreArtworkLimiter ??= createRateLimiter({
      limit: ARTWORK_RATE_LIMIT,
      windowMs: RATE_WINDOW_MS,
    })),
  );
}

function meter(request: Request, limiter: ReturnType<typeof createRateLimiter>): Response | null {
  const verdict = limiter.check(clientKey(request));
  if (verdict.ok) return null;

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

/** Runs `produce` unless an identical call is cached or already in flight. One store serves
 * every route, so it holds `unknown` and keys are namespaced by the caller. */
export function cached<T>(key: string, produce: () => Promise<T>): Promise<T> {
  return responseCache().take(key, produce as () => Promise<unknown>) as Promise<T>;
}

/** Edge `cache-control` for answers that move daily at best — charts, radio. */
export const CACHE_CONTROL_HOUR = "public, s-maxage=3600, stale-while-revalidate=86400";

/** Longer, for facts about an artist, which change on the scale of a release. */
export const CACHE_CONTROL_DAY = "public, s-maxage=86400, stale-while-revalidate=604800";
