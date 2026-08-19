// SoundCloud — playable with no credentials at all, and searchable only if the operator
// supplies somewhere to search. Two traps: the host is `soundcloud.com/oembed`, *not*
// `api.soundcloud.com/oembed`, which every search result points at and which answers 401
// (verified 2026-08-15); and `searchable` is false **unless `apiBase` is set**, because
// catalogue search needs a `client_id` gated behind paid approval while playback needs none.
//
// `apiBase` is the self-host escape hatch, and it is deliberately not a hosted capability.
// It points at something the *operator* runs — a soundcloak instance exposes an allowlisted
// reverse proxy for `api-v2.soundcloud.com` at `/_/api/v2`, injecting the `client_id` server
// side — so the extraction technique this project declined stays in someone else's repo, run
// by the person who chose to run it, on their own IP. Timbre's hosted build leaves the
// variable unset and never calls `api-v2` directly or indirectly. See `docs/BLOCKED.md`.

import type { SearchContext, SearchProvider, SourceTrack } from "./types.ts";
import { createRequester } from "./request.ts";

const OEMBED = "https://soundcloud.com/oembed";

/** Their page ceiling: asking for more silently returns fewer. */
const MAX_PAGE = 200;

/** `artwork_url` arrives as the 100px `-large` variant; every size shares one URL shape. */
function biggerArtwork(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/-large(\.[a-z]+)$/i, "-t500x500$1");
}

interface SoundCloudUser {
  username?: string;
}

interface SoundCloudApiTrack {
  id?: number;
  title?: string;
  duration?: number;
  permalink_url?: string;
  artwork_url?: string | null;
  user?: SoundCloudUser;
  publisher_metadata?: { artist?: string | null; isrc?: string | null } | null;
}

/** One `api-v2` search hit as a Timbre track. The uploader is the fallback artist, not the
 * first choice: `publisher_metadata.artist` is the credited one where a release has been
 * registered, and the uploader is whoever posted it — often a label or a mix channel. */
function fromApiTrack(raw: SoundCloudApiTrack): SourceTrack | null {
  if (!raw.id || !raw.title) return null;

  const artist = raw.publisher_metadata?.artist?.trim() || raw.user?.username?.trim();

  return {
    source: "soundcloud",
    sourceId: String(raw.id),
    title: raw.title.trim(),
    artists: artist ? [artist] : [],
    album: null,
    durationMs: raw.duration ?? null,
    // Measured present on 28% of results (108/392) — thin, but a real ISRC beats a title
    // match every time, and it is 28% more than Audius offers.
    isrc: raw.publisher_metadata?.isrc?.trim() || null,
    url: raw.permalink_url ?? null,
    artworkUrl: biggerArtwork(raw.artwork_url),
    playback: "queue",
  };
}

interface SoundCloudOEmbed {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
  html?: string;
}

/** Recognises a public SoundCloud track URL. */
export function isSoundCloudUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.replace(/^www\./, "");
    return host === "soundcloud.com" || host === "m.soundcloud.com";
  } catch {
    return false;
  }
}

/** Digs the numeric track id out of the player iframe oEmbed returns — not a field, and
 * stable across permalink renames where the URL is not. */
function trackIdFromHtml(html: string | undefined): string | null {
  if (!html) return null;
  // Matched encoded *and* plain rather than decoding the markup first: the iframe
  // carries width="100%", and `%"` makes decodeURIComponent throw on the whole string.
  const match = html.match(/api\.soundcloud\.com(?:%2F|\/)tracks(?:%2F|\/)(\d+)/i);
  return match?.[1] ?? null;
}

/** oEmbed titles arrive as "Flickermood by Forss" — the artist is already in
 * `author_name`, and the suffix would poison title matching in the merger. */
function stripArtistSuffix(title: string, artist: string | undefined): string {
  if (!artist) return title;
  const suffix = ` by ${artist}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length).trim() : title;
}

const request = createRequester({
  id: "soundcloud",
  label: "SoundCloud",
  // No cache policy: oEmbed is the playback path, not a catalogue read Next may revalidate.
  init: () => ({ cache: "no-store" }),
  // A private, deleted or geo-blocked track is normal, not a provider failure.
  softStatuses: [403, 404],
});

export interface SoundCloudOptions {
  /** An `api-v2`-shaped base the operator runs, e.g. `https://<instance>/_/api/v2`.
   * Unset means unsearchable, which is the shipped default. */
  apiBase?: string;
}

export function createSoundCloudProvider(options: SoundCloudOptions = {}): SearchProvider {
  const apiBase = options.apiBase?.replace(/\/+$/, "");

  return {
    id: "soundcloud",
    playback: "queue",
    searchable: Boolean(apiBase),

    async search(ctx, query, limit) {
      // Unreachable when unset, since `searchable` gates the fan-out — but a provider that
      // silently returned nothing would be indistinguishable from one whose upstream died.
      if (!apiBase) return [];

      const body = await request<{ collection?: SoundCloudApiTrack[] }>(
        ctx,
        `${apiBase}/search/tracks?q=${encodeURIComponent(query)}&limit=${Math.min(limit, MAX_PAGE)}`,
      );
      return (body?.collection ?? []).map(fromApiTrack).filter((track): track is SourceTrack => track !== null);
    },

    async resolve(ctx: SearchContext, url: string): Promise<SourceTrack | null> {
      if (!isSoundCloudUrl(url)) return null;

      const body = await request<SoundCloudOEmbed>(
        ctx,
        `${OEMBED}?format=json&url=${encodeURIComponent(url)}`,
      );
      if (!body?.title) return null;

      const artist = body.author_name?.trim();

      return {
        source: "soundcloud",
        sourceId: trackIdFromHtml(body.html) ?? url,
        title: stripArtistSuffix(body.title.trim(), artist),
        artists: artist ? [artist] : [],
        album: null,
        // oEmbed exposes neither; the merger falls back to title and artist.
        durationMs: null,
        isrc: null,
        url,
        artworkUrl: body.thumbnail_url ?? null,
        playback: "queue",
      };
    },
  };
}
