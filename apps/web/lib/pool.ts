import "server-only";

/**
 * `Promise.all` over a mapper, with at most `limit` in flight.
 *
 * `apps/web/lib/deezer.ts` is the one Deezer caller that does not go through `RateLimiter` —
 * it is a server-side reader of a public API, so it never needed a bucket — but `genre-feed.ts`
 * fans a single page request out into twenty-odd album lookups at once, and a handful of
 * concurrent readers is enough to trip Deezer's quota. A quota refusal then arrives as
 * `DeezerUnavailable`, which `deezer()` forgives into `null` and `deezerList` into `[]`, so the
 * genre page renders empty with a 200 and fifteen minutes of `s-maxage` over the top —
 * indistinguishable from a genre with nothing fresh in it. Not queueing is what makes that
 * reachable, so this is the half worth fixing.
 *
 * Order is preserved: results land at the index their input came from.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  map: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length <= limit) return Promise.all(items.map(map));

  const results = new Array<R>(items.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await map(items[index]!, index);
    }
  };

  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}
