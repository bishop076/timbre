export type Cache<T> = ReturnType<typeof createCache<T>>;

export function createCache<T>({
  ttlMs,
  max,
  now = Date.now,
}: {
  ttlMs: number;
  max: number;
  now?: () => number;
}) {
  const entries = new Map<string, { value: T; expiresAt: number }>();
  const inFlight = new Map<string, Promise<T>>();

  return {
    get size() {
      return entries.size;
    },

    async take(key: string, produce: () => Promise<T>): Promise<T> {
      const hit = entries.get(key);
      if (hit && hit.expiresAt > now()) return hit.value;
      if (hit) entries.delete(key);

      const pending = inFlight.get(key);
      if (pending) return pending;

      const call = produce()
        .then((value) => {
          if (entries.size >= max) entries.delete(entries.keys().next().value!);
          entries.set(key, { value, expiresAt: now() + ttlMs });
          return value;
        })
        .finally(() => inFlight.delete(key));

      inFlight.set(key, call);
      return call;
    },
  };
}
