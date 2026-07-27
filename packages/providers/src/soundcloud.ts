/**
 * SoundCloud.
 *
 * The one source besides YouTube Music that Timbre can actually **play**, and it
 * needs no credentials whatsoever to do it: the oEmbed endpoint and the HTML5
 * Widget API are both public. Timbre embeds SoundCloud's own player, unmodified
 * — their stream, their branding, their play counts.
 *
 * Two things are load-bearing and easy to get wrong:
 *
 * 1. **The host is `soundcloud.com/oembed`, not `api.soundcloud.com/oembed`.**
 *    Most documentation and every search result points at the `api.` host, which
 *    now answers **401**. The bare host answers 200 with no credentials at all.
 *    Verified 2026-08-15.
 *
 * 2. **`searchable` is false, and that is not a bug.** SoundCloud's catalogue
 *    search needs a `client_id`, which needs a paid Artist Pro account and a
 *    manual approval that may never come. Playback needs none of that. So this
 *    provider contributes through `resolve` only — see `docs/BLOCKED.md`.
 */

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

/**
 * oEmbed does not return the track id as a field, but the player iframe it
 * builds carries one — `…/player/?url=…api.soundcloud.com%2Ftracks%2F293…`.
 * Worth digging out: a numeric id is stable across permalink renames, whereas
 * the URL is not.
 */
function trackIdFromHtml(html: string | undefined): string | null {
  if (!html) return null;
  // Matched in both encoded and plain form rather than decoding the markup
  // first: the iframe carries width="100%", and `%"` is not valid percent
  // encoding, so decodeURIComponent throws on the whole string.
  const match = html.match(/api\.soundcloud\.com(?:%2F|\/)tracks(?:%2F|\/)(\d+)/i);
  return match?.[1] ?? null;
}

/**
 * oEmbed titles arrive as "Flickermood by Forss". The artist is already in
 * `author_name`, so the suffix is redundant and would poison title matching in
 * the merger.
 */
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
    // See the file header. Playback is free; search is gated.
    searchable: false,

    // Required by the interface, and genuinely empty. `searchable: false` tells
    // callers not to bother, so this should never be reached.
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

      // A private, deleted or geo-blocked track is a normal outcome, not a
      // failure of the provider — the caller should carry on without it.
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
        // Prefer the numeric id; fall back to the permalink, which the Widget
        // accepts just as happily.
        sourceId: trackIdFromHtml(body.html) ?? url,
        title: stripArtistSuffix(body.title.trim(), artist),
        artists: artist ? [artist] : [],
        album: null,
        // oEmbed exposes neither duration nor ISRC. Both stay null rather than
        // being guessed — the merger treats a missing duration as "unknown"
        // and falls back to title and artist, which is the correct behaviour.
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
