// Spotify — playable, and only ever on a tap.
//
// **What is possible.** `open.spotify.com/embed/track/{id}` needs no key, no developer app
// and no Premium, and `open.spotify.com/oembed` returns the title and cover for a track URL
// with no credentials either (both verified 2026-08-19). A listener signed into Spotify —
// a *free* account is enough — hears the whole track; anyone else hears the 30-second
// preview Spotify chooses to give them. Ads run and royalties are paid because it is
// Spotify's own player doing the playing.
//
// **What is not.** The embed exposes no play API, so nothing here can start it: a person
// has to press it. That is not caution, it is the surface. It also happens to be what keeps
// this clear of Developer Terms §IV.2, which forbids integrating Spotify's streams with
// another service's — a panel the reader starts is not a queue that blends them. Hence
// `playback: "manual"`, which `types.ts` has described for exactly this since before there
// was anything to describe.
//
// **Why search is not here.** Spotify's official search needs a developer app, and since
// Feb 2026 that needs Premium and caps at five users. Search lives in `spotify-web.ts`
// instead, on the anonymous token every embed page carries, and stays out of `searchAll`:
// its results render in their own section and never merge into the ranked list. This
// provider remains what plays a Spotify track, however it was found.

import { DEFAULT_POLICIES, ProviderError } from "@timbre/core";

import type { SearchContext, SearchProvider, SourceTrack } from "./types.ts";
import { createRequester, deadlineSignal } from "./request.ts";

const OEMBED = "https://open.spotify.com/oembed";
const EMBED = "https://open.spotify.com/embed";

/** MetaBrainz's dataset hoster — the resolver that makes a Spotify id free. */
const LABS = "https://labs.api.listenbrainz.org";
const MUSICBRAINZ = "https://musicbrainz.org/ws/2";

/** MusicBrainz requires a contactable agent and refuses generic ones. */
const AGENT = "Timbre/0.1 ( https://github.com/bishop076/timbre )";

/**
 * `/track/{22}`, the localised `/intl-pt/track/{22}` shape their own share links use, and
 * `/embed/track/{22}`.
 *
 * **The embed form was missing and it is not an exotic one.** It is what Spotify's own Share
 * → Embed dialog produces, what every copied iframe `src` contains, and — measured — what a
 * reader ends up with after opening the embed directly to check something. Pasting one
 * returned *"That link isn't from a service Timbre can play"* while the track id sat in plain
 * sight in the path.
 */
const TRACK_PATH = /^(?:\/intl-[a-z]{2,5})?(?:\/embed)?\/track\/([A-Za-z0-9]{22})\/?$/;

interface SpotifyOEmbed {
  title?: string;
  thumbnail_url?: string;
}

/** The shape Spotify's embed page hands its own React app. */
interface SpotifyEntity {
  title?: string;
  artists?: { name?: string }[];
  /** Milliseconds. */
  duration?: number;
  isPlayable?: boolean;
  visualIdentity?: { image?: { url?: string; maxHeight?: number }[] };
}

/**
 * Reads the embed page's own hydration payload, which carries strictly more than oEmbed:
 * the **artist** and the **duration**, neither of which oEmbed publishes. Without it a
 * pasted Spotify link resolves to "Unknown artist" and no length, and matches nothing.
 *
 * Best-effort by construction — this is Spotify's private page data, not a documented
 * surface, so any failure falls back to oEmbed rather than failing the resolve.
 */
async function entityFromEmbed(ctx: SearchContext, trackId: string): Promise<SpotifyEntity | null> {
  try {
    await ctx.limiter.acquire("spotify", DEFAULT_POLICIES.spotify);
    const response = await fetch(spotifyEmbedUrl(trackId), { signal: deadlineSignal(ctx.signal), cache: "no-store" });
    if (!response.ok) return null;

    const html = await response.text();
    const payload = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
    if (!payload?.[1]) return null;

    const data = JSON.parse(payload[1]) as {
      props?: { pageProps?: { state?: { data?: { entity?: SpotifyEntity } } } };
    };
    return data.props?.pageProps?.state?.data?.entity ?? null;
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    // A layout change, a parse failure, a blocked request — all mean the same thing here.
    return null;
  }
}

/** The largest cover the page offers. */
function largestCover(entity: SpotifyEntity | null): string | null {
  const images = entity?.visualIdentity?.image ?? [];
  const best = [...images].sort((a, b) => (b.maxHeight ?? 0) - (a.maxHeight ?? 0))[0];
  return best?.url ?? null;
}

/** The track id in a Spotify URL, or null for an album, playlist, artist or anything else.
 * oEmbed answers 200 for all of those, so the shape has to be checked here — otherwise
 * pasting an album link would produce a "track" that is not one. */
export function spotifyTrackId(raw: string): string | null {
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "");
    if (host !== "open.spotify.com") return null;
    return TRACK_PATH.exec(url.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** The iframe a reader taps. Mirrored in `app/player/embed-url.ts` for the client. */
export function spotifyEmbedUrl(trackId: string): string {
  return `${EMBED}/track/${encodeURIComponent(trackId)}`;
}

const request = createRequester({
  id: "spotify",
  label: "Spotify",
  init: () => ({ cache: "no-store" }),
  // A withdrawn or region-locked track is normal, not a provider failure.
  softStatuses: [400, 404],
});

interface LabsRow {
  spotify_track_ids?: string[];
}

/**
 * Finds the Spotify copy of a recording Timbre already knows about — **free, keyless, and
 * with no developer app anywhere.**
 *
 * `BLOCKED.md` and this file's own header both said the id was the thing that could not be
 * had. MetaBrainz publishes a resolver: `labs.api.listenbrainz.org` maps a recording onto its
 * Spotify ids, built so ListenBrainz can export its own playlists. That provenance is the
 * point — it exists for a structural reason rather than a generous one, unlike Odesli's,
 * which went away.
 *
 * Two routes, cheapest first:
 *
 * 1. **By metadata**, when the album is known — one call. Deezer supplies the album for any
 *    song it merged into, so this is the common path. It needs all three of artist, release
 *    and track; artist plus track alone is a `400`.
 * 2. **By ISRC**, otherwise — MusicBrainz turns the ISRC into a recording MBID, then the same
 *    resolver takes the MBID. Two calls, and the more precise of the two: neither hop is a
 *    fuzzy match, which is what keeps an instrumental from resolving to the parent recording
 *    the way MusicBrainz's own *search* does.
 *
 * **Server-side only.** The labs host sends `Access-Control-Allow-Origin: *` and would be
 * callable from the browser, but MusicBrainz sends none and requires a contactable
 * `User-Agent`, which a browser will not let script set.
 *
 * **Abstains on every failure.** The labs host is not SLA'd — neighbouring endpoints have
 * been seen returning `500` under load — so a miss here must look exactly like "this song is
 * not on Spotify" rather than an error.
 */
export async function findSpotifyTrackId(
  ctx: SearchContext,
  lookup: { title: string; artist?: string | null; album?: string | null; isrc?: string | null },
): Promise<string | null> {
  const title = lookup.title?.trim();
  if (!title) return null;

  const artist = lookup.artist?.trim();
  const album = lookup.album?.trim();

  if (artist && album) {
    const params = new URLSearchParams({
      artist_name: artist,
      release_name: album,
      track_name: title,
    });
    const rows = await labs<LabsRow[]>(ctx, `/spotify-id-from-metadata/json?${params}`);
    const id = rows?.[0]?.spotify_track_ids?.[0];
    if (id) return id;
  }

  const isrc = lookup.isrc?.trim();
  if (!isrc) return null;

  // One request, and usually the answer: the streaming links ride along with the ISRC
  // lookup that was being made anyway. See `isrcLookup`.
  const { mbid, spotifyId } = await isrcLookup(ctx, isrc);
  if (spotifyId) return spotifyId;
  if (!mbid) return null;

  // Only when MusicBrainz carries the recording but nobody has linked it: the dataset is
  // sparse where the relations are absent, and the reverse, so it is worth the second hop.
  const rows = await labs<LabsRow[]>(
    ctx,
    `/spotify-id-from-mbid/json?recording_mbid=${encodeURIComponent(mbid)}`,
  );
  return rows?.[0]?.spotify_track_ids?.[0] ?? null;
}

/** One keyless GET against the dataset hoster, abstaining on anything unexpected. */
async function labs<T>(ctx: SearchContext, path: string): Promise<T | null> {
  try {
    await ctx.limiter.acquire("spotify", DEFAULT_POLICIES.spotify);
    const response = await fetch(`${LABS}${path}`, { signal: deadlineSignal(ctx.signal), cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    return null;
  }
}

interface MusicBrainzRecording {
  id?: string;
  relations?: { url?: { resource?: string } }[];
}

/** A Spotify track id sitting in a `open.spotify.com/track/…` URL. */
const SPOTIFY_TRACK_URL = /open\.spotify\.com\/track\/([A-Za-z0-9]+)/;

/**
 * One ISRC lookup, asking for the streaming links at the same time.
 *
 * **`inc=url-rels` is the whole trick.** MusicBrainz records where a recording can be
 * streamed as ordinary URL relationships, and asking for them costs nothing extra — it is
 * the same request that was already being made for the MBID. Measured 2026-08-20 against
 * the songs the labs dataset misses: *Get Lucky*, *Starboy* and *Blinding Lights* all
 * resolve here in **one request**, and all three return nothing from
 * `spotify-id-from-mbid`.
 *
 * Both are returned because the two are complementary rather than ranked: the relation is
 * present when an editor added it, the dataset when MetaBrainz's mapping found it.
 */
async function isrcLookup(
  ctx: SearchContext,
  isrc: string,
): Promise<{ mbid: string | null; spotifyId: string | null }> {
  const empty = { mbid: null, spotifyId: null };
  try {
    await ctx.limiter.acquire("spotify", DEFAULT_POLICIES.spotify);
    const response = await fetch(
      `${MUSICBRAINZ}/isrc/${encodeURIComponent(isrc)}?inc=url-rels&fmt=json`,
      {
        // The deadline every adapter carries (`request.ts`); these three calls bypass
        // `createRequester` and had none, so a stalled host held /api/resolve open.
        signal: deadlineSignal(ctx.signal),
        cache: "no-store",
        headers: { "User-Agent": AGENT, Accept: "application/json" },
      },
    );
    if (!response.ok) return empty;

    const body = (await response.json()) as { recordings?: MusicBrainzRecording[] };
    const recordings = body.recordings ?? [];

    for (const recording of recordings) {
      for (const relation of recording.relations ?? []) {
        const found = SPOTIFY_TRACK_URL.exec(relation.url?.resource ?? "")?.[1];
        if (found) return { mbid: recordings[0]?.id ?? null, spotifyId: found };
      }
    }
    return { mbid: recordings[0]?.id ?? null, spotifyId: null };
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    return empty;
  }
}

export function createSpotifyProvider(): SearchProvider {
  return {
    id: "spotify",
    playback: "manual",
    searchable: false,

    // Required by the interface; `searchable: false` means it is never reached.
    async search() {
      return [];
    },

    async resolve(ctx: SearchContext, url: string): Promise<SourceTrack | null> {
      const id = spotifyTrackId(url);
      if (!id) return null;

      const entity = await entityFromEmbed(ctx, id);

      // oEmbed is the floor, not the source of truth: it is documented and stable but
      // publishes neither artist nor duration. Only reached when the page above did not
      // parse, so the common path is one request rather than two.
      const fallback = entity?.title
        ? null
        : await request<SpotifyOEmbed>(
            ctx,
            `${OEMBED}?url=${encodeURIComponent(`https://open.spotify.com/track/${id}`)}`,
          );

      const title = entity?.title?.trim() || fallback?.title?.trim();
      if (!title) return null;

      // Withdrawn and region-locked tracks say so here. Resolving one would put a row in the
      // queue whose embed shows an error instead of a play button.
      if (entity && entity.isPlayable === false) return null;

      return {
        source: "spotify",
        sourceId: id,
        title,
        artists: (entity?.artists ?? [])
          .map((artist) => artist.name?.trim())
          .filter((name): name is string => Boolean(name)),
        album: null,
        durationMs: entity?.duration ?? null,
        isrc: null,
        url: `https://open.spotify.com/track/${id}`,
        artworkUrl: largestCover(entity) ?? fallback?.thumbnail_url ?? null,
        playback: "manual",
      };
    },
  };
}
