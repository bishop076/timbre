// A small TTL cache for upstream results, scoped to one server instance — which is also the
// scope of the limit it defends: Apple's catalogue API allows roughly 20 requests/minute per
// IP, and every visitor shares the deployment's outbound IP. Concurrent identical misses
// share one call, or ten people searching the same song produce ten requests that all store
// the same answer. Rejections are never stored: caching a transient failure would turn one
// bad minute into a whole TTL. No `server-only` guard — that import throws outside a server
// component, which would make this untestable under `node --test`.

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

/** Builds a cache whose `take` returns a stored value or produces and stores one. */
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
      // Dropped now, or a failing producer serves stale data indefinitely.
      if (hit) entries.delete(key);

      const pending = inFlight.get(key);
      if (pending) return pending;

      const call = produce()
        .then((value) => {
          // Map preserves insertion order, so evicting the first key is a plain FIFO.
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
