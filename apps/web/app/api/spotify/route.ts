import { findSpotifyTrackId } from "@timbre/providers";
import { z } from "zod";

import { getProviderRuntime } from "@/lib/providers";
import { optionalQueryText, queryText } from "@/lib/query-text";
import { guard, CACHE_CONTROL_DAY } from "@/lib/api";

// Where else this song lives. Answers the one question that kept Spotify out of Timbre —
// *which* track is it — using MetaBrainz's own resolver, which needs no key, no account and
// no developer app. See `docs/SEARCH-ROUTES.md` R9.
//
// **Server-side because MusicBrainz makes it so.** The ListenBrainz labs host sends
// `Access-Control-Allow-Origin: *` and would be reachable from the browser, but the ISRC hop
// runs through MusicBrainz, which sends no CORS header and requires a contactable
// `User-Agent` that script cannot set.
//
// **Only a hit is cached.** A recording's Spotify id does not change, so a hit is worth
// holding hard — the chain costs up to two upstream calls and MusicBrainz publishes a real
// rate budget (`X-RateLimit-Remaining: 179` while this was written). An *abstention* is not a
// fact: the resolver returns null both for "not on Spotify" and for "the dataset host was
// briefly down", and that host is explicitly not SLA'd. Caching the two together turns a blip
// into a permanent wrong answer — which happened here during development, and is why the two
// paths are separated rather than sharing one `cache-control`.
export const dynamic = "force-dynamic";

const querySchema = z.object({
  title: queryText(300),
  artist: optionalQueryText(200),
  album: optionalQueryText(300),
  isrc: optionalQueryText(24),
});

/**
 * Memoises a found id **and nothing else**, so a bad minute upstream cannot become a
 * permanent "not on Spotify".
 *
 * Deliberately not `lib/cache.ts`: that one stores whatever the producer returns, which is
 * right for a search answer and wrong here, because null carries two different meanings. A
 * plain Map of hits is enough — per instance like everything else, bounded because a hit is
 * 22 bytes and a song is only asked about while it plays.
 */
const hits = new Map<string, string>();
const MAX_HITS = 500;

async function cachedHit(key: string, produce: () => Promise<string | null>): Promise<string | null> {
  const held = hits.get(key);
  if (held) return held;

  const found = await produce();
  if (!found) return null;

  // Oldest out first; insertion order is Map's own.
  if (hits.size >= MAX_HITS) {
    const oldest = hits.keys().next();
    if (!oldest.done) hits.delete(oldest.value);
  }
  hits.set(key, found);
  return found;
}

export async function GET(request: Request) {
  const refusal = guard(request);
  if (refusal) return refusal;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    title: url.searchParams.get("title") ?? undefined,
    artist: url.searchParams.get("artist") ?? undefined,
    album: url.searchParams.get("album") ?? undefined,
    isrc: url.searchParams.get("isrc") ?? undefined,
  });

  if (!parsed.success) {
    return Response.json({ error: "A track title is required." }, { status: 400 });
  }

  const { title, artist, album, isrc } = parsed.data;

  // Nothing to go on: the metadata route needs an album and the precise route needs an ISRC.
  if (!album && !isrc) return Response.json({ trackId: null }, { status: 200 });

  const { limiter } = getProviderRuntime();
  const key = `spotify:${isrc ?? ""}:${artist ?? ""}:${album ?? ""}:${title}`;

  const trackId = await cachedHit(key, () =>
    findSpotifyTrackId({ limiter, signal: request.signal }, { title, artist, album, isrc }),
  );

  // **Always 200, never 404.** "Not on Spotify" is an ordinary answer here, and the resolver
  // abstains on upstream failure too — so a 404 would make a missing song and a broken
  // dataset host look identical to the caller.
  return Response.json(
    { trackId: trackId ?? null },
    { headers: { "cache-control": trackId ? CACHE_CONTROL_DAY : "no-store" } },
  );
}
