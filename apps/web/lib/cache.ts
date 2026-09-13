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

    /**
     * `keep` decides whether an answer is worth remembering. Without it every resolved value
     * was stored, including the degraded ones — a search whose first caller happened to catch
     * a provider mid-blip pinned that provider's absence into the cache and served it to
     * everyone for the full TTL, long after the provider recovered. A rejection was never
     * cached; a partial success looked identical to a whole one and was.
     */
    async take(
      key: string,
      produce: () => Promise<T>,
      keep: (value: T) => boolean = () => true,
    ): Promise<T> {
      const hit = entries.get(key);
      if (hit && hit.expiresAt > now()) return hit.value;
      if (hit) entries.delete(key);

      const pending = inFlight.get(key);
      if (pending) return pending;

      const call = produce()
        .then((value) => {
          if (!keep(value)) return value;
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
