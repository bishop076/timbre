/*
 * YouTube Music, via the Python sidecar. The primary source: free, keyless and complete
 * in search and playback. `ytmusicapi` searches unauthenticated, so there are no tokens.
 */

import type { SearchContext, SearchProvider, SourceTrack } from "./types.ts";
import { createRequester } from "./request.ts";

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

export function createYtMusicProvider(config: YtMusicConfig): SearchProvider {
  const request = createRequester({
    id: "ytmusic",
    label: "YouTube Music sidecar",
    // Every call is a POST carrying the shared secret, and is never cached.
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
  });

  const call = <T>(ctx: SearchContext, path: string, body: unknown): Promise<T> =>
    request<T>(ctx, new URL(path, config.baseUrl), { body: JSON.stringify(body) });

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
  };
}
