/**
 * A small TTL cache for upstream results.
 *
 * This exists for one specific limit. Apple's public catalogue API allows
 * roughly **20 requests per minute per IP**, and every visitor shares the
 * deployment's single outbound IP — so the ceiling is 20/minute for the whole
 * site, not per person. Search is debounced but still fires on typing, and the
 * popular queries are the same few for everybody. Caching them is what keeps a
 * handful of simultaneous readers from spending the whole minute's budget.
 *
 * Two behaviours, and the second matters as much as the first:
 *
 * - **Repeat within the TTL** returns the stored value and makes no call.
 * - **Concurrent identical misses share one call.** Without this, ten people
 *   searching the same song at once produce ten upstream requests that all
 *   populate the cache with the same answer — the cache would be doing nothing
 *   at exactly the moment it is needed most.
 *
 * Scope is one server instance, deliberately. Timbre runs no database and no
 * shared cache, so this cannot be global — but neither is the limit it defends,
 * which is per-IP, and an instance has one IP. The two scopes agree.
 *
 * Rejections are never stored. A failed source is normally transient, and
 * caching the failure would turn one bad minute into a whole TTL of them.
 *
 * No `server-only` guard, unlike `env.ts` and `providers.ts`. This holds no
 * secrets and is a plain data structure — and that import throws outside a
 * server component, which would make the whole thing untestable under
 * `node --test`. The guard belongs where there is something to protect.
 */

export interface Cache<T> {
  take(key: string, produce: () => Promise<T>): Promise<T>;
  /** Entries currently held. Exposed for tests and diagnostics. */
  readonly size: number;
}

export interface CacheOptions {
  ttlMs: number;
  /** Hard cap on entries, so a stream of unique queries cannot grow forever. */
  max: number;
  /** Injectable so tests need no timers. */
  now?: () => number;
}

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export function createCache<T>({ ttlMs, max, now = Date.now }: CacheOptions): Cache<T> {
  const entries = new Map<string, Entry<T>>();
  const inFlight = new Map<string, Promise<T>>();

  return {
    get size() {
      return entries.size;
    },

    async take(key, produce) {
      const hit = entries.get(key);
      if (hit && hit.expiresAt > now()) return hit.value;
      // Expired: drop it now so a failing producer cannot serve stale data
      // indefinitely by never replacing it.
      if (hit) entries.delete(key);

      const pending = inFlight.get(key);
      if (pending) return pending;

      const call = produce()
        .then((value) => {
          // Map preserves insertion order, so the first key is the oldest and
          // evicting it is a plain FIFO — good enough for a cache whose whole
          // job is absorbing bursts of the same few queries.
          if (entries.size >= max) {
            const oldest = entries.keys().next();
            if (!oldest.done) entries.delete(oldest.value);
          }
          entries.set(key, { value, expiresAt: now() + ttlMs });
          return value;
        })
        .finally(() => {
          inFlight.delete(key);
        });

      inFlight.set(key, call);
      return call;
    },
  };
}
