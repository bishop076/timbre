/*
 * YouTube Music, via the Python sidecar. The primary source: free, keyless and complete
 * in search and playback. `ytmusicapi` searches unauthenticated, so there are no tokens.
 */

import type { SearchContext, SearchProvider, SourceTrack } from "./types.ts";
import { createRequester, type RequesterOptions } from "./request.ts";

interface SidecarTrack {
  video_id: string;
  title: string;
  artists: string[];
  album: string | null;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  is_explicit: boolean;
  result_type: string;
  /** The upload's kind, read by the recommendation ranker. */
  video_type: string | null;
}

export interface YtMusicConfig {
  baseUrl: string;
  sharedSecret: string;
}

/** What the sidecar's `/playlist` answers: the playlist's own details around search-shaped tracks. */
interface SidecarPlaylist {
  id: string;
  title: string;
  author: string | null;
  year: string | null;
  track_count: number | null;
  thumbnail_url: string | null;
  tracks: SidecarTrack[];
}

/** A public YouTube or YouTube Music playlist, an album's `OLAK5uy_` list among them. */
export interface YtMusicPlaylist {
  id: string;
  title: string;
  author: string | null;
  year: string | null;
  /** What YouTube says the list holds — more than `tracks` for a long list, or for one whose
   * uploads have since been taken down. */
  trackCount: number | null;
  artworkUrl: string | null;
  tracks: SourceTrack[];
}

/** YouTube Music, plus the one thing only it can do here: open a playlist by id. */
export interface YtMusicProvider extends SearchProvider {
  /** A playlist, or null when there is no public one with this id — private, personal,
   * deleted, or a radio mix, which has no playlist page to read. */
  playlist(ctx: SearchContext, id: string, limit: number): Promise<YtMusicPlaylist | null>;
}

/**
 * Shaped like a playlist id, and not a mix.
 *
 * The sidecar checks the shape again; this is what keeps a request from being made at all.
 * `RD…` is refused except `RDCLAK5uy_`, YouTube Music's editorial playlists: every other `RD`
 * id is a radio mix — the `list=` on a `watch?v=` link opened from one — which has no
 * playlist page behind it and only ever comes back not-found. Personal lists (`LL`, `WL`,
 * `LM`) are too short to pass, which is also right: they need a login this app never has.
 */
export function isYtMusicPlaylistId(id: string): boolean {
  return /^[A-Za-z0-9_-]{12,64}$/.test(id) && (!id.startsWith("RD") || id.startsWith("RDCLAK5uy_"));
}

/** Picks the YouTube Music provider out of the registry, typed for `playlist`. */
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
    // No ISRC is exposed, so @timbre/core's matcher carries merging for this source.
    isrc: null,
    url: `https://music.youtube.com/watch?v=${raw.video_id}`,
    artworkUrl: raw.thumbnail_url,
    playback: "queue",
    videoType: raw.video_type ?? null,
  };
}

/** How every sidecar request goes out: a POST with the shared secret, never cached. */
function sidecarOptions(config: YtMusicConfig, deadlineMs?: number): RequesterOptions {
  return {
    id: "ytmusic",
    label: "YouTube Music sidecar",
    deadlineMs,
    init: () => ({
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-timbre-secret": config.sharedSecret,
      },
      cache: "no-store",
    }),
    // The sidecar returns 502 when ytmusicapi itself fails upstream, which is
    // worth retrying or falling back from; anything else is our bug.
    classify: (status) => (status === 502 ? "transient" : "unknown"),
  };
}

/** A POST to one sidecar route. Shared so a route that is not a search — lyrics — goes out
 * with the same secret, pacing and error classes rather than a second copy of them. */
export type SidecarCall = <T>(ctx: SearchContext, path: string, body: unknown) => Promise<T>;

export function createSidecarCall(config: YtMusicConfig, deadlineMs?: number): SidecarCall {
  const request = createRequester(sidecarOptions(config, deadlineMs));
  return <T>(ctx: SearchContext, path: string, body: unknown): Promise<T> =>
    request<T>(ctx, new URL(path, config.baseUrl), { body: JSON.stringify(body) });
}

export function createYtMusicProvider(config: YtMusicConfig): YtMusicProvider {
  const call = createSidecarCall(config);
  // `/playlist` is the one route whose 404 is an answer rather than a fault: the request was
  // fine and the playlist is not public. That status reads as null; every other stays an error.
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

    /**
     * Two lists from one request: the watch queue and the "you might also like" panel, whose
     * id only the first returns. Kept apart because they disagree, and that is what the
     * ranker measures.
     */
    async radio(ctx, seed, limit) {
      // Needs this service's own id — a Deezer-only song has none until resolved.
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
        // The same mapping as search, so a song opened from a playlist is the same song —
        // same id, same source, same `videoType` for the ranker — as one found by name.
        tracks: data.tracks.map(toSourceTrack),
      };
    },
  };
}
