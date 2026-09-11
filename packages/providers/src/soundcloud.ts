import type { SearchContext, SearchProvider, SourceTrack } from "./types.ts";
import { createRequester } from "./request.ts";

const OEMBED = "https://soundcloud.com/oembed";

const MAX_PAGE = 200;

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
  policy?: string;
  full_duration?: number;
  permalink_url?: string;
  artwork_url?: string | null;
  user?: SoundCloudUser;
  publisher_metadata?: { artist?: string | null; isrc?: string | null } | null;
}

function fromApiTrack(raw: SoundCloudApiTrack): SourceTrack | null {
  if (!raw.id || !raw.title) return null;

  if (raw.policy === "SNIP") return null;

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

export function isSoundCloudUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.replace(/^www\./, "");
    return host === "soundcloud.com" || host === "m.soundcloud.com";
  } catch {
    return false;
  }
}

function trackIdFromHtml(html: string | undefined): string | null {
  if (!html) return null;
  const match = html.match(/api\.soundcloud\.com(?:%2F|\/)tracks(?:%2F|\/)(\d+)/i);
  return match?.[1] ?? null;
}

function stripArtistSuffix(title: string, artist: string | undefined): string {
  if (!artist) return title;
  const suffix = ` by ${artist}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length).trim() : title;
}

const request = createRequester({
  id: "soundcloud",
  label: "SoundCloud",
  init: () => ({ cache: "no-store" }),
  softStatuses: [403, 404],
});

const API_V2 = "https://api-v2.soundcloud.com";

export interface SoundCloudOptions {
  apiBase?: string;
  clientId?: () => Promise<string | null>;
}

export function createSoundCloudProvider(options: SoundCloudOptions = {}): SearchProvider {
  const apiBase = options.apiBase?.replace(/\/+$/, "");
  const clientId = options.clientId;

  return {
    id: "soundcloud",
    playback: "queue",
    searchable: Boolean(apiBase || clientId),

    async search(ctx, query, limit) {
      if (!apiBase && !clientId) return [];

      const query_ = `q=${encodeURIComponent(query)}&limit=${Math.min(limit, MAX_PAGE)}`;
      let url: string;
      if (apiBase) {
        url = `${apiBase}/search/tracks?${query_}`;
      } else {
        const id = await clientId!();
        if (!id) return [];
        url = `${API_V2}/search/tracks?${query_}&client_id=${encodeURIComponent(id)}`;
      }

      const body = await request<{ collection?: SoundCloudApiTrack[] }>(ctx, url);
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
        durationMs: null,
        isrc: null,
        url,
        artworkUrl: body.thumbnail_url ?? null,
        playback: "queue",
      };
    },
  };
}
