/**
 * Deezer.
 *
 * The public catalogue needs **no authentication at all** — no key, no app, no
 * approval — and, uniquely among the free sources, search results carry
 * **ISRCs**. That makes Deezer the backbone of cross-source matching: YouTube
 * Music exposes no ISRC, so a Deezer result is often what lets Timbre say with
 * confidence that two results are the same recording.
 *
 * Timbre cannot play Deezer audio, so tracks are `link` playback. Their value
 * is identity and availability, not sound.
 */

import { DEFAULT_POLICIES, ProviderError } from "@timbre/core";

import type { SearchContext, SearchProvider, SourceTrack } from "./types.ts";

const API = "https://api.deezer.com";

interface DeezerTrack {
  id: number;
  title: string;
  duration: number;
  isrc?: string;
  link?: string;
  explicit_lyrics?: boolean;
  artist?: { name?: string };
  album?: { title?: string; cover_medium?: string; cover_big?: string };
}

function toSourceTrack(raw: DeezerTrack): SourceTrack {
  return {
    source: "deezer",
    sourceId: String(raw.id),
    title: raw.title,
    artists: raw.artist?.name ? [raw.artist.name] : [],
    album: raw.album?.title ?? null,
    durationMs: raw.duration ? raw.duration * 1000 : null,
    isrc: raw.isrc ?? null,
    url: raw.link ?? `https://www.deezer.com/track/${raw.id}`,
    artworkUrl: raw.album?.cover_big ?? raw.album?.cover_medium ?? null,
    playback: "link",
    isExplicit: Boolean(raw.explicit_lyrics),
  };
}

export function createDeezerProvider(): SearchProvider {
  async function get<T>(ctx: SearchContext, path: string): Promise<T> {
    await ctx.limiter.acquire("deezer", DEFAULT_POLICIES.deezer);

    let response: Response;
    try {
      response = await fetch(`${API}${path}`, { signal: ctx.signal, cache: "no-store" });
    } catch (cause) {
      throw new ProviderError("deezer", "transient", "Deezer unreachable.", { cause });
    }

    if (!response.ok) {
      throw new ProviderError("deezer", "transient", `Deezer returned ${response.status}.`, {
        status: response.status,
      });
    }

    const body = (await response.json()) as T & { error?: { message?: string } };
    // Deezer signals quota and validation failures in a 200 body rather than a
    // status code, so the happy path has to be checked explicitly.
    if (body && typeof body === "object" && "error" in body && body.error) {
      throw new ProviderError("deezer", "transient", body.error.message ?? "Deezer error.");
    }
    return body;
  }

  return {
    id: "deezer",
    displayName: "Deezer",
    playback: "link",
    searchable: true,

    async search(ctx, query, limit) {
      const data = await get<{ data?: DeezerTrack[] }>(
        ctx,
        `/search?q=${encodeURIComponent(query)}&limit=${limit}`,
      );
      return (data.data ?? []).map(toSourceTrack);
    },

    async chart(ctx, limit) {
      const data = await get<{ data?: DeezerTrack[] }>(ctx, `/chart/0/tracks?limit=${limit}`);
      return (data.data ?? []).map(toSourceTrack);
    },
  };
}
