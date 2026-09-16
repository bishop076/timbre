import { ProviderError } from "@timbre/core";

import type { SearchProvider, SourceTrack } from "./types.ts";
import { createRequester, type RequesterOptions } from "./request.ts";

const MAX_PAGE = 200;
const EMBEDDED_TRACK_ID = /api\.soundcloud\.com(?:%2F|\/)tracks(?:%2F|\/)(\d+)/i;

interface SoundCloudApiTrack {
  id?: number;
  title?: string;
  duration?: number;
  policy?: string;
  media?: { transcodings?: { snipped?: boolean }[] };
  permalink_url?: string;
  artwork_url?: string | null;
  user?: { username?: string };
  publisher_metadata?: { artist?: string | null; isrc?: string | null } | null;
}

interface SoundCloudOEmbed {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
  html?: string;
}

function isClip({ policy, media }: SoundCloudApiTrack): boolean {
  return policy === "SNIP" || Boolean(media?.transcodings?.some((transcoding) => transcoding.snipped));
}

function fromApiTrack(raw: SoundCloudApiTrack): SourceTrack | null {
  if (!raw.id || !raw.title || isClip(raw)) return null;
  const artist = raw.publisher_metadata?.artist?.trim() || raw.user?.username?.trim();
  return {
    source: "soundcloud",
    sourceId: String(raw.id),
    title: raw.title.trim(),
    artists: artist ? [artist] : [],
    album: null,
    durationMs: raw.duration ?? null,
    isrc: raw.publisher_metadata?.isrc?.trim() || null,
    url: raw.permalink_url ?? null,
    artworkUrl: raw.artwork_url ? raw.artwork_url.replace(/-large(\.[a-z]+)$/i, "-t500x500$1") : null,
    playback: "queue",
  };
}

function isSoundCloudUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "");
    return /^https?:$/.test(url.protocol) && (host === "soundcloud.com" || host === "m.soundcloud.com");
  } catch {
    return false;
  }
}

const soundcloud: RequesterOptions = {
  id: "soundcloud",
  label: "SoundCloud",
  init: () => ({ cache: "no-store" }),
};

const request = createRequester(soundcloud);

// Only `resolve` may read a refusal as an answer, and only because it is asked about links that
// are not SoundCloud's: oEmbed 404s a track it does not have and 403s one that is private, which
// really is "no such track". `/search/tracks` does neither — a 403 there is SoundCloud turning
// this server away — so sharing one requester between the two made an outage look like a page
// with no results on it.
const lookup = createRequester({ ...soundcloud, softStatuses: [403, 404] });

export interface SoundCloudOptions {
  apiBase?: string;
  clientId?: () => Promise<string | null>;
}

export function createSoundCloudProvider(options: SoundCloudOptions = {}): SearchProvider {
  const apiBase = options.apiBase?.replace(/\/+$/, "");
  const { clientId } = options;

  return {
    id: "soundcloud",
    playback: "queue",
    searchable: Boolean(apiBase || clientId),

    async search(ctx, query, limit) {
      const id = apiBase ? null : await clientId?.();
      // Still no waiting — the resolver hands back `null` the moment its own deadline passes,
      // and this returns at once. What changed is that it says so. Returning `[]` reported a
      // provider that never got as far as asking as a provider that looked and found nothing:
      // `searchAll` counted SoundCloud in `attempted`, put nothing in `failures`, and the route
      // answered `{ songs: [], failures: [], attempted: 1 }` while SoundCloud was refusing every
      // request. The crawl then backs off for five minutes, so the silence held for all of it.
      if (!apiBase && !id) {
        throw new ProviderError("soundcloud", "transient", "SoundCloud would not hand over a key to search with.");
      }

      const params = `q=${encodeURIComponent(query)}&limit=${Math.min(limit, MAX_PAGE)}`;
      const url = id
        ? `https://api-v2.soundcloud.com/search/tracks?${params}&client_id=${encodeURIComponent(id)}`
        : `${apiBase}/search/tracks?${params}`;
      const body = await request<{ collection?: SoundCloudApiTrack[] }>(ctx, url);
      return (body.collection ?? []).flatMap((raw) => fromApiTrack(raw) ?? []);
    },

    async resolve(ctx, url) {
      if (!isSoundCloudUrl(url)) return null;

      const body = await lookup<SoundCloudOEmbed>(
        ctx,
        `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`,
      );
      if (!body?.title) return null;

      const artist = body.author_name?.trim();
      const title = body.title.trim();
      const suffix = ` by ${artist}`;
      return {
        source: "soundcloud",
        sourceId: body.html?.match(EMBEDDED_TRACK_ID)?.[1] ?? url,
        title: artist && title.endsWith(suffix) ? title.slice(0, -suffix.length).trim() : title,
        artists: artist ? [artist] : [],
        album: null,
        durationMs: null,
        isrc: null,
        url,
        artworkUrl: body.thumbnail_url ?? null,
        playback: "queue",
      };
    },
  };
}
