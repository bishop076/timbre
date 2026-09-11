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

function toSourceTrack(raw: SidecarTrack): SourceTrack {
  return {
    source: "ytmusic",
    sourceId: raw.video_id,
    title: raw.title,
    artists: raw.artists,
    album: raw.album,
    durationMs: raw.duration_seconds === null ? null : raw.duration_seconds * 1000,
    isrc: null,
    url: `https://music.youtube.com/watch?v=${raw.video_id}`,
    artworkUrl: raw.thumbnail_url,
    playback: "queue",
    videoType: raw.video_type ?? null,
  };
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
      return data.items.map(toSourceTrack);
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
        { list: "ytmusic:radio", tracks: data.radio.map(toSourceTrack) },
        { list: "ytmusic:related", tracks: data.related.map(toSourceTrack) },
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
        tracks: data.tracks.map(toSourceTrack),
      };
    },
  };
}
