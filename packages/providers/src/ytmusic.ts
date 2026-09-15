import { ProviderError } from "@timbre/core";

import type { SearchContext, SearchProvider, SourceTrack } from "./types.ts";
import { createRequester, type RequesterOptions } from "./request.ts";

interface SidecarTrack {
  video_id: string;
  title: string;
  artists: string[];
  album: string | null;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  video_type: string | null;
}

interface SidecarPlaylist {
  id: string;
  title: string;
  author: string | null;
  year: string | null;
  track_count: number | null;
  thumbnail_url: string | null;
  tracks: SidecarTrack[];
}

export interface YtMusicPlaylist {
  id: string;
  title: string;
  author: string | null;
  year: string | null;
  trackCount: number | null;
  artworkUrl: string | null;
  tracks: SourceTrack[];
}

export interface YtMusicProvider extends SearchProvider {
  playlist(ctx: SearchContext, id: string, limit: number): Promise<YtMusicPlaylist | null>;
}

export function isYtMusicPlaylistId(id: string): boolean {
  return /^[A-Za-z0-9_-]{12,64}$/.test(id) && (!id.startsWith("RD") || id.startsWith("RDCLAK5uy_"));
}

export function isYtMusicProvider(provider: SearchProvider): provider is YtMusicProvider {
  return provider.id === "ytmusic" && "playlist" in provider;
}

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

function toSourceTrack(raw: SidecarTrack): SourceTrack | null {
  const id = text(raw?.video_id);
  const title = text(raw?.title);
  if (!id || !title) return null;

  return {
    source: "ytmusic",
    sourceId: id,
    title,
    artists: Array.isArray(raw.artists) ? raw.artists.filter((name) => typeof name === "string") : [],
    album: text(raw.album),
    durationMs: typeof raw.duration_seconds === "number" ? raw.duration_seconds * 1000 : null,
    isrc: null,
    url: `https://music.youtube.com/watch?v=${encodeURIComponent(id)}`,
    artworkUrl: text(raw.thumbnail_url),
    playback: "queue",
    videoType: text(raw.video_type),
  };
}

/**
 * The sidecar's own list, checked before anything walks it.
 *
 * This was the one boundary in the package where the answer was trusted outright — `data.items`,
 * `data.radio`, `data.tracks` were each `.map`ped straight off the parsed body — and the damage
 * was not confined to this provider. `searchAll` catches what a provider throws, but it ranks
 * and merges the pooled result *outside* that guard, so a single track whose `artists` came back
 * null failed the whole search: `TypeError: Cannot read properties of null (reading 'flatMap')`,
 * with Apple's and Deezer's perfectly good answers lost alongside it.
 *
 * The sidecar declares a `response_model` on every route, so a healthy one cannot send this. That
 * is an argument for the shape being reliable, not for not checking it: `YTMUSIC_SERVICE_URL` is
 * configuration, and the point of parsing at the boundary is that the far side does not have to
 * be malicious to be wrong. A list that is not a list is this source failing, and says so; a
 * single track that is not a track is dropped, exactly as every other provider drops one.
 */
function tracksFrom(value: unknown, what: string): SourceTrack[] {
  if (!Array.isArray(value)) {
    throw new ProviderError(
      "ytmusic",
      "unknown",
      `The YouTube Music sidecar answered with no ${what} Timbre could read.`,
    );
  }
  return value.flatMap((raw) => toSourceTrack(raw as SidecarTrack) ?? []);
}

export interface YtMusicConfig {
  baseUrl: string;
  sharedSecret: string;
}

function sidecarOptions(config: YtMusicConfig): RequesterOptions {
  return {
    id: "ytmusic",
    label: "YouTube Music sidecar",
    init: () => ({
      method: "POST",
      headers: { "content-type": "application/json", "x-timbre-secret": config.sharedSecret },
      cache: "no-store",
    }),
    classify: (status) => (status === 502 ? "transient" : "unknown"),
  };
}

export function createSidecarCall(config: YtMusicConfig, deadlineMs?: number) {
  const request = createRequester({ ...sidecarOptions(config), deadlineMs });
  return <T>(ctx: SearchContext, path: string, body: unknown): Promise<T> =>
    request<T>(ctx, new URL(path, config.baseUrl), { body: JSON.stringify(body) });
}

export function createYtMusicProvider(config: YtMusicConfig): YtMusicProvider {
  const call = createSidecarCall(config);
  const lookup = createRequester({ ...sidecarOptions(config), softStatuses: [404] });

  return {
    id: "ytmusic",
    playback: "queue",
    searchable: true,

    async search(ctx, query, limit) {
      const data = await call<{ items: SidecarTrack[] }>(ctx, "/search", { query, limit });
      return tracksFrom(data.items, "results");
    },

    async resolve(ctx, url) {
      const data = await call<{ track: SidecarTrack | null }>(ctx, "/resolve", { url });
      return data.track ? toSourceTrack(data.track) : null;
    },

    async radio(ctx, seed, limit) {
      if (!seed.sourceId) return [];
      const data = await call<{ radio: SidecarTrack[]; related: SidecarTrack[] }>(ctx, "/radio", {
        video_id: seed.sourceId,
        limit,
      });
      return [
        { list: "ytmusic:radio", tracks: tracksFrom(data.radio, "radio") },
        { list: "ytmusic:related", tracks: tracksFrom(data.related, "related tracks") },
      ];
    },

    async playlist(ctx, id, limit) {
      if (!isYtMusicPlaylistId(id)) return null;
      const data = await lookup<SidecarPlaylist>(ctx, new URL("/playlist", config.baseUrl), {
        body: JSON.stringify({ playlist_id: id, limit }),
      });
      if (!data) return null;
      return {
        id: data.id,
        title: data.title,
        author: data.author,
        year: data.year,
        trackCount: data.track_count,
        artworkUrl: data.thumbnail_url,
        tracks: tracksFrom(data.tracks, "playlist tracks"),
      };
    },
  };
}
