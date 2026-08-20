// Audius. The only source Timbre can both **search and play** without a key, an account or
// an approval — verified end to end 2026-08-19. Two things follow from that and shape this
// adapter.
//
// **It is the first source Timbre plays itself.** Every other playable source runs inside
// its owner's iframe; Audius streams progressive audio over plain HTTP, so `audius-player`
// is a real `<audio>` element. That does not cross a stated non-goal — nothing is cached or
// downloaded and the bytes still come from Audius's own CDN — but it is a deliberate change
// in what the product is. See `docs/BLOCKED.md`.
//
// **Its catalogue is the derivative layer, and nothing else.** Searching Timbre's own
// suggested queries returned remixes, edits, mashups, covers and Boiler Room sets — not one
// original. Note the complementarity is *not* "YouTube Music has originals, Audius has
// remixes" — YouTube Music returns remixes and hour-long DJ sets on the same queries. The
// axis is **released versus unreleased**: asked for the exact artist and title of twelve
// Audius results, YouTube Music had ten of them nowhere (measured 2026-08-19). Audius is the
// unsigned-upload source. That makes Audius complementary to YouTube Music rather than overlapping, and it
// makes the variant rule in `@timbre/core` load-bearing here: these titles are *all*
// variants, and `isrc` is present in the schema but was empty on every track sampled, so the
// merger falls to title+artist+duration with nothing to backstop it.

import type { RadioSeed, RankedList, SearchContext, SearchProvider, SourceTrack } from "./types.ts";
import { cachePolicy } from "./cache-policy.ts";
import { createRequester } from "./request.ts";

const API = "https://api.audius.co/v1";
const WEB = "https://audius.co";

interface AudiusArtwork {
  "150x150"?: string;
  "480x480"?: string;
  "1000x1000"?: string;
  /** Hosts serving the same content-addressed image. Audius publishes these because its
   * content nodes are independently operated and go down independently. */
  mirrors?: string[];
}

interface AudiusTrack {
  id: string;
  title: string;
  /** Seconds, not milliseconds. */
  duration?: number;
  permalink?: string;
  artwork?: AudiusArtwork | null;
  user?: { name?: string; handle?: string };
  isrc?: string | null;
  genre?: string | null;
  is_streamable?: boolean;
  is_available?: boolean;
  is_delete?: boolean;
  is_unlisted?: boolean;
  /** Non-null on token- or follow-gated uploads, which 403 at stream time. */
  stream_conditions?: unknown;
}

/**
 * Whether a track will actually play. Audius returns gated, hidden and deleted uploads in
 * ordinary search results, and the only signal that one is unplayable arrives *here* — at
 * stream time it is a bare 403. Filtering at search keeps them out of the queue entirely,
 * which matters more than usual because a queue member that cannot start stalls playback
 * rather than degrading it.
 */
function playable(raw: AudiusTrack): boolean {
  if (raw.is_delete || raw.is_unlisted) return false;
  if (raw.is_streamable === false || raw.is_available === false) return false;
  // `null` is ungated. Anything else is a gate this app cannot satisfy.
  return raw.stream_conditions === null || raw.stream_conditions === undefined;
}

/** The same image on the other nodes that hold it. The path is content-addressed, so only
 * the host changes. */
function artworkMirrors(artwork: AudiusArtwork | null | undefined): string[] | undefined {
  const primary = artwork?.["480x480"] ?? artwork?.["1000x1000"] ?? artwork?.["150x150"];
  const mirrors = artwork?.mirrors;
  if (!primary || !mirrors?.length) return undefined;

  try {
    const path = new URL(primary).pathname;
    return mirrors.map((host) => `${host.replace(/\/+$/, "")}${path}`);
  } catch {
    return undefined;
  }
}

function toSourceTrack(raw: AudiusTrack): SourceTrack {
  const artist = raw.user?.name?.trim() || raw.user?.handle?.trim();

  return {
    source: "audius",
    // The track id, not the permalink: the stream endpoint is keyed by id.
    sourceId: raw.id,
    title: raw.title,
    artists: artist ? [artist] : [],
    // Audius has no album concept in the track payload; playlists are a separate entity.
    album: null,
    durationMs: raw.duration ? raw.duration * 1000 : null,
    // Schema carries it, corpus does not: 0 of 20 populated on a sampled search. Read
    // rather than assumed, so a future populated field starts working on its own.
    // **Blank is absent.** Audius sends `""` rather than omitting the field, and an empty
    // string is not null — it survives `??` and then *is* the song id in `merge.ts`, so
    // every track without an ISRC collided on the same one. Three of them shared a React key.
    isrc: raw.isrc?.trim() || null,
    url: raw.permalink ? `${WEB}${raw.permalink}` : null,
    artworkUrl: raw.artwork?.["480x480"] ?? raw.artwork?.["1000x1000"] ?? raw.artwork?.["150x150"] ?? null,
    artworkFallbacks: artworkMirrors(raw.artwork),
    playback: "queue",
  };
}

const request = createRequester({
  id: "audius",
  label: "Audius",
  init: cachePolicy,
});

const get = <T>(ctx: SearchContext, path: string): Promise<T> => request<T>(ctx, `${API}${path}`);

/**
 * The URL an `<audio>` element is pointed at. Deliberately the API's own redirecting
 * endpoint rather than a resolved CDN link: `/stream` answers **302** to a *signed* URL on
 * whichever content node holds the track, and that signature carries a timestamp. Resolving
 * it here would mint a link at search time that may have expired by the time anyone presses
 * play; letting the browser follow the redirect resolves it at the moment of playback and
 * makes expiry impossible by construction.
 *
 * **`skip_play_count=false` is why the listen counts.** Without it the redirect arrives
 * carrying `skip_play_count=true` and the play is never recorded — which for a player whose
 * whole pitch is that artists are paid as they otherwise would be is not a detail. It is a
 * leak rather than a policy: `stream_util.go` probes candidate mirrors with that flag set so
 * the health check is not counted as a listen, and the flag survives into the URL it
 * returns. `redirectToStream` overrides it with whatever the caller passed, so passing
 * `false` explicitly is the documented way back. Verified 2026-08-19: the override reaches
 * the content node and audio still answers `206 audio/mpeg`.
 */
export function audiusStreamUrl(trackId: string): string {
  return `${API}/tracks/${encodeURIComponent(trackId)}/stream?skip_play_count=false`;
}

/** How many versions of the seed to fetch. Small: this list is a garnish on the ranking, not
 * the body of it, and every entry is a round trip's worth of payload. */
const VERSIONS = 8;

export function createAudiusProvider(): SearchProvider {
  return {
    id: "audius",
    playback: "queue",
    searchable: true,

    async search(ctx, query, limit) {
      // Over-fetch, because `playable` removes some of what comes back and a short page is
      // worse than a slightly larger one.
      const asked = Math.min(limit * 2, 100);
      const data = await get<{ data?: AudiusTrack[] }>(
        ctx,
        `/tracks/search?query=${encodeURIComponent(query)}&limit=${asked}`,
      );
      return (data.data ?? []).filter(playable).slice(0, limit).map(toSourceTrack);
    },

    /**
     * **Seeded by title, never by artist.** Audius has no usable artist lookup for the
     * music Timbre plays: `/users/search` is fuzzy and matched *The Weeknd* to "Louis The
     * Child", *Harry Styles* to a user called "Harry", and *Flume* to three empty accounts
     * squatting the name (measured 2026-08-19). An artist seed here is not merely
     * unhelpful in the way `docs/RECOMMENDATIONS.md` records Deezer's artist radio to be —
     * it is confidently **wrong**, and would feed a stranger's catalogue into the ranking
     * wearing the seed artist's name.
     *
     * What Audius does hold is other people's takes on the song that just played, which no
     * other source carries. So the list it contributes is honest about being a different
     * kind of evidence: `audius:versions`, one list, low consensus by construction, ranked
     * near the tail — which is the correct place for "and here are six remixes of that".
     */
    async radio(ctx, seed: RadioSeed, limit): Promise<RankedList[]> {
      if (!seed.title) return [];

      // Artist included when known: bare titles like "Alright" otherwise return a different
      // song entirely, and a wrong recommendation is worse than a missing one.
      const query = [seed.title, seed.artist].filter(Boolean).join(" ");
      const asked = Math.min(Math.max(limit, VERSIONS) * 2, 100);

      const data = await get<{ data?: AudiusTrack[] }>(
        ctx,
        `/tracks/search?query=${encodeURIComponent(query)}&limit=${asked}`,
      );
      const tracks = (data.data ?? []).filter(playable).slice(0, VERSIONS).map(toSourceTrack);

      // An empty list is an abstention. Pushing one would tell the ranker Audius answered.
      return tracks.length > 0 ? [{ list: "audius:versions", tracks }] : [];
    },

    // **No `chart` on purpose, though `/tracks/trending` is verified working.** Explore fuses
    // Deezer and Apple so that agreeing on two beats charting higher on one, and Audius
    // trending is a disjoint population — independent uploads that by construction agree
    // with neither. Adding it would not enrich that consensus, it would dilute it with two
    // dozen songs no other source has heard of. If Audius trending is wanted it belongs in
    // its own shelf, which is a product decision rather than a provider one. See
    // `docs/RECOMMENDATIONS.md`.
  };
}
