import "server-only";

import { createCache } from "./cache";
import { clientKey, createRateLimiter } from "./rate-limit";

/**
 * Shared back-pressure for Timbre's public API routes.
 *
 * Both structures are cached on `globalThis` for the reason `providers.ts`
 * gives: Next re-evaluates modules on every hot reload, and a cache or counter
 * rebuilt on each edit remembers nothing. In production the module is evaluated
 * once and this is simply a singleton.
 *
 * Every route here is unauthenticated, because Timbre is meant to work from a
 * link with no account. That makes the client's address the only thing to meter
 * on, and the reason to meter at all is that the tightest limit in the system
 * belongs to somebody else: Apple allows about 20 requests per minute **per
 * IP**, and every visitor shares this deployment's one outbound address.
 */

const globalForApi = globalThis as unknown as {
  __timbreResponseCache?: ReturnType<typeof createCache<unknown>>;
  __timbreInboundLimiter?: ReturnType<typeof createRateLimiter>;
};

/**
 * Two minutes.
 *
 * Long enough to absorb a debounced search box and a room of people looking up
 * the same song; short enough that a newly published track is not missing for
 * an appreciable time. Catalogues change over days, not seconds, so the cost of
 * this staleness is close to nothing.
 */
const CACHE_TTL_MS = 120_000;

/** Roughly a few hundred distinct queries — a few MB at most. */
const CACHE_MAX_ENTRIES = 500;

/**
 * 60 requests/minute/client.
 *
 * Well above a person using the app — a debounced search is a handful of calls
 * — and well below what a retry loop or an open tab refreshing can spend. It is
 * sized to stop accidents, not attacks; see `rate-limit.ts` on why it cannot be
 * the latter without shared state.
 */
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

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

/**
 * Metered access. Returns a `429` to return from the handler, or `null` to
 * carry on.
 *
 * A refusal carries `Retry-After` because a client that does not know when to
 * come back will come back immediately, which is how a throttle turns into the
 * hot loop it was meant to stop.
 */
export function guard(request: Request): Response | null {
  const verdict = inboundLimiter().check(clientKey(request));
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

/**
 * Runs `produce` unless an identical call is cached or already in flight.
 *
 * The single cast is contained here: one store serves every route, so it holds
 * `unknown` and each caller names the shape it put in. Keys are namespaced by
 * the caller to keep routes from colliding.
 */
export function cached<T>(key: string, produce: () => Promise<T>): Promise<T> {
  return responseCache().take(key, produce as () => Promise<unknown>) as Promise<T>;
}
