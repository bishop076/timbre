// SoundCloud — the one source besides YouTube Music that Timbre can **play**, with no
// credentials at all. Two traps: the host is `soundcloud.com/oembed`, *not*
// `api.soundcloud.com/oembed`, which every search result points at and which answers 401
// (verified 2026-08-15); and `searchable` is false deliberately, because catalogue search
// needs a `client_id` gated behind paid approval while playback needs none. See
// `docs/BLOCKED.md`.

import { DEFAULT_POLICIES, ProviderError } from "@timbre/core";

import type { SearchContext, SearchProvider, SourceTrack } from "./types.ts";

const OEMBED = "https://soundcloud.com/oembed";

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

export function createSoundCloudProvider(): SearchProvider {
  return {
    id: "soundcloud",
    displayName: "SoundCloud",
    playback: "queue",
    searchable: false,

    // Required by the interface. `searchable: false` means this is never reached.
    async search() {
      return [];
    },

    async resolve(ctx: SearchContext, url: string): Promise<SourceTrack | null> {
      if (!isSoundCloudUrl(url)) return null;

      await ctx.limiter.acquire("soundcloud", DEFAULT_POLICIES.soundcloud);

      let response: Response;
      try {
        response = await fetch(`${OEMBED}?format=json&url=${encodeURIComponent(url)}`, {
          signal: ctx.signal,
          cache: "no-store",
        });
      } catch (cause) {
        throw new ProviderError("soundcloud", "transient", "SoundCloud unreachable.", { cause });
      }

      // A private, deleted or geo-blocked track is normal, not a provider failure.
      if (response.status === 403 || response.status === 404) return null;

      if (!response.ok) {
        throw new ProviderError(
          "soundcloud",
          "transient",
          `SoundCloud returned ${response.status}.`,
          { status: response.status },
        );
      }

      const body = (await response.json()) as SoundCloudOEmbed;
      if (!body.title) return null;

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
        isExplicit: false,
      };
    },
  };
}
