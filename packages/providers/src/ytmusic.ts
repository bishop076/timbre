/**
 * YouTube Music, via the Python sidecar.
 *
 * Timbre's primary source: the only one that is free, keyless and complete in
 * both search and playback. Nobody logs in — `ytmusicapi` searches
 * unauthenticated — so there are no tokens here at all.
 */

import { DEFAULT_POLICIES, ProviderError } from "@timbre/core";

import type { SearchContext, SearchProvider, SourceTrack } from "./types.ts";

/** The sidecar's wire shape. Kept local; nothing outside this file sees it. */
interface SidecarTrack {
  video_id: string;
  title: string;
  artists: string[];
  album: string | null;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  is_explicit: boolean;
  result_type: string;
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
    // YouTube Music exposes no ISRC, which is why the metadata matcher in
    // @timbre/core carries the weight of cross-source merging for this source.
    isrc: null,
    url: `https://music.youtube.com/watch?v=${raw.video_id}`,
    artworkUrl: raw.thumbnail_url,
    playback: "queue",
    isExplicit: raw.is_explicit,
  };
}

export function createYtMusicProvider(config: YtMusicConfig): SearchProvider {
  async function call<T>(
    ctx: SearchContext,
    path: string,
    body: unknown,
  ): Promise<T> {
    await ctx.limiter.acquire("ytmusic", DEFAULT_POLICIES.ytmusic);

    let response: Response;
    try {
      response = await fetch(new URL(path, config.baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-timbre-secret": config.sharedSecret,
        },
        body: JSON.stringify(body),
        signal: ctx.signal,
        cache: "no-store",
      });
    } catch (cause) {
      throw new ProviderError("ytmusic", "transient", "YouTube Music sidecar unreachable.", {
        cause,
      });
    }

    if (!response.ok) {
      // The sidecar returns 502 when ytmusicapi itself fails upstream, which is
      // worth retrying or falling back from; anything else is our bug.
      throw new ProviderError(
        "ytmusic",
        response.status === 502 ? "transient" : "unknown",
        `YouTube Music sidecar returned ${response.status}.`,
        { status: response.status },
      );
    }

    return (await response.json()) as T;
  }

  return {
    id: "ytmusic",
    displayName: "YouTube Music",
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
  };
}
