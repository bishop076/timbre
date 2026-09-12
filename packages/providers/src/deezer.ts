import { ProviderError } from "@timbre/core";

import type { RankedList, SearchContext, SearchProvider, SourceTrack } from "./types.ts";
import { cachePolicy } from "./cache-policy.ts";
import { createRequester } from "./request.ts";

const SIMILAR_ARTISTS = 3;
const TOP_PER_ARTIST = 5;

interface DeezerTrack {
  id: number;
  title: string;
  duration: number;
  isrc?: string;
  link?: string;
  preview?: string;
  artist?: { name?: string };
  album?: { title?: string; cover_medium?: string; cover_big?: string };
}

interface DeezerArtist {
  id?: number;
  name: string;
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
    previewUrl: raw.preview || null,
  };
}

// Deezer localises artist names to the country it geolocates the caller to, from the
// request IP alone — `country=US` is ignored, only `Accept-Language` moves it. Left alone,
// a server in Tokyo returns テーム・インパラ for Tame Impala, and merge.ts keys on the
// artist name, so the same song from Deezer and Apple stops deduping.
const HEADERS = { "accept-language": "en-US,en;q=0.9" };

const request = createRequester({
  id: "deezer",
  label: "Deezer",
  init: (ctx) => ({ ...cachePolicy(ctx), headers: HEADERS }),
  checkBody: (body) => {
    const error = (body as { error?: { message?: string } } | null)?.error;
    if (error) throw new ProviderError("deezer", "transient", error.message ?? "Deezer error.");
  },
});

const get = async <T>(ctx: SearchContext, path: string): Promise<T[]> =>
  (await request<{ data?: T[] }>(ctx, `https://api.deezer.com${path}`)).data ?? [];

const getTracks = async (ctx: SearchContext, path: string): Promise<SourceTrack[]> =>
  (await get<DeezerTrack>(ctx, path)).map(toSourceTrack);

export function createDeezerProvider(): SearchProvider {
  return {
    id: "deezer",
    playback: "link",
    searchable: true,

    search(ctx, query, limit) {
      return getTracks(ctx, `/search?q=${encodeURIComponent(query)}&limit=${limit}`);
    },

    chart(ctx, limit) {
      return getTracks(ctx, `/chart/0/tracks?limit=${limit}`);
    },

    async radio(ctx, seed, limit) {
      const name = seed.artist ?? "";
      const wanted = name.trim().toLowerCase();
      if (!wanted) return [];

      const found = await get<DeezerArtist>(ctx, `/search/artist?q=${encodeURIComponent(name)}&limit=5`);
      const match = found.find((entry) => entry.name?.toLowerCase() === wanted);
      if (!match?.id) return [];

      const [top, similar] = await Promise.allSettled([
        getTracks(ctx, `/artist/${match.id}/top?limit=${limit}`),
        get<DeezerArtist>(ctx, `/artist/${match.id}/related?limit=${SIMILAR_ARTISTS}`),
      ]);

      const lists: RankedList[] = [];
      if (top.status === "fulfilled") lists.push({ list: "deezer:artist-top", tracks: top.value });

      if (similar.status === "fulfilled") {
        const artists = similar.value.filter((entry) => entry.id).slice(0, SIMILAR_ARTISTS);
        const tops = await Promise.allSettled(
          artists.map((entry) => getTracks(ctx, `/artist/${entry.id}/top?limit=${TOP_PER_ARTIST}`)),
        );
        const tracks = tops.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
        if (tracks.length > 0) lists.push({ list: "deezer:similar-artists", tracks });
      }
      return lists;
    },
  };
}
