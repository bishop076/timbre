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
};

/** Two minutes: absorbs a debounced search box and a room looking up the same song. */
const CACHE_TTL_MS = 120_000;

/** Roughly a few hundred distinct queries — a few MB at most. */
const CACHE_MAX_ENTRIES = 500;

/** 60/minute/client — above a person, below a retry loop. Sized to stop accidents, not
 * attacks; see `rate-limit.ts` for why it cannot be the latter without shared state. */
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

/** Metered access: a `429` to return from the handler, or `null` to carry on. The refusal
 * carries `Retry-After` because a client that does not know when to come back comes back
 * immediately, turning a throttle into the hot loop it was meant to stop. */
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

/** Runs `produce` unless an identical call is cached or already in flight. One store serves
 * every route, so it holds `unknown` and keys are namespaced by the caller. */
export function cached<T>(key: string, produce: () => Promise<T>): Promise<T> {
  return responseCache().take(key, produce as () => Promise<unknown>) as Promise<T>;
}
