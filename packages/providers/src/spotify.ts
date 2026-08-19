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
// **Why there is no search.** Spotify's catalogue search needs a developer app, and since
// Feb 2026 that needs Premium and caps at five users — a limit no amount of building moves.
// Track ids *are* freely available from any web index, since Spotify's track pages are
// indexed for SEO, but Timbre would need a search index of its own to query one and its own
// search page renders no ids server-side (checked: 156KB of HTML, zero). So Timbre can play
// a Spotify track you already found and cannot find one for you — the same shape as
// SoundCloud, for entirely different reasons.

import { DEFAULT_POLICIES, ProviderError } from "@timbre/core";

import type { SearchContext, SearchProvider, SourceTrack } from "./types.ts";
import { createRequester } from "./request.ts";

const OEMBED = "https://open.spotify.com/oembed";
const EMBED = "https://open.spotify.com/embed";

/** `/track/{22}`, and the localised `/intl-pt/track/{22}` shape their own share links use. */
const TRACK_PATH = /^(?:\/intl-[a-z]{2,5})?\/track\/([A-Za-z0-9]{22})\/?$/;

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
    const response = await fetch(spotifyEmbedUrl(trackId), { signal: ctx.signal, cache: "no-store" });
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
