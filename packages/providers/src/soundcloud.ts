import type { SearchProvider, SourceTrack } from "./types.ts";
import { createRequester } from "./request.ts";

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

const request = createRequester({
  id: "soundcloud",
  label: "SoundCloud",
  init: () => ({ cache: "no-store" }),
  softStatuses: [403, 404],
});

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
      if (!apiBase && !id) return [];

      const params = `q=${encodeURIComponent(query)}&limit=${Math.min(limit, MAX_PAGE)}`;
      const url = id
        ? `https://api-v2.soundcloud.com/search/tracks?${params}&client_id=${encodeURIComponent(id)}`
        : `${apiBase}/search/tracks?${params}`;
      const body = await request<{ collection?: SoundCloudApiTrack[] }>(ctx, url);
      return (body?.collection ?? []).flatMap((raw) => fromApiTrack(raw) ?? []);
    },

    async resolve(ctx, url) {
      if (!isSoundCloudUrl(url)) return null;

      const body = await request<SoundCloudOEmbed>(
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
