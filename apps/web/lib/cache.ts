export interface Cache<T> {
  take(key: string, produce: () => Promise<T>): Promise<T>;
  readonly size: number;
}

export interface CacheOptions {
  ttlMs: number;
  max: number;
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
      if (hit) entries.delete(key);

      const pending = inFlight.get(key);
      if (pending) return pending;

      const call = produce()
        .then((value) => {
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
