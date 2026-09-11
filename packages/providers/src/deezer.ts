import { ProviderError } from "@timbre/core";

import type {
  RankedList,
  SearchContext,
  SearchProvider,
  SourceTrack,
} from "./types.ts";
import { cachePolicy } from "./cache-policy.ts";
import { createRequester } from "./request.ts";

const API = "https://api.deezer.com";

interface DeezerTrack {
  id: number;
  title: string;
  duration: number;
  isrc?: string;
  link?: string;
  preview?: string;
  explicit_lyrics?: boolean;
  artist?: { name?: string };
  album?: { title?: string; cover_medium?: string; cover_big?: string };
}

interface DeezerArtist {
  id?: number;
  name: string;
}

const SIMILAR_ARTISTS = 3;
const TOP_PER_ARTIST = 5;

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

const request = createRequester({
  id: "deezer",
  label: "Deezer",
  init: cachePolicy,
  checkBody: (body) => {
    const error = (body as { error?: { message?: string } } | null)?.error;
    if (error) throw new ProviderError("deezer", "transient", error.message ?? "Deezer error.");
  },
});

const get = <T>(ctx: SearchContext, path: string): Promise<T> => request<T>(ctx, `${API}${path}`);

export function createDeezerProvider(): SearchProvider {
  async function findArtist(ctx: SearchContext, name: string): Promise<DeezerArtist | null> {
    const wanted = name.trim().toLowerCase();
    if (!wanted) return null;

    const data = await get<{ data?: DeezerArtist[] }>(
      ctx,
      `/search/artist?q=${encodeURIComponent(name)}&limit=5`,
    );
    return (data.data ?? []).find((entry) => entry.name?.toLowerCase() === wanted) ?? null;
  }

  return {
    id: "deezer",
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

    async radio(ctx, seed, limit): Promise<RankedList[]> {
      if (!seed.artist) return [];

      const match = await findArtist(ctx, seed.artist);
      if (!match?.id) return [];

      const [top, similar] = await Promise.allSettled([
        get<{ data?: DeezerTrack[] }>(ctx, `/artist/${match.id}/top?limit=${limit}`),
        get<{ data?: DeezerArtist[] }>(ctx, `/artist/${match.id}/related?limit=${SIMILAR_ARTISTS}`),
      ]);

      const lists: RankedList[] = [];

      if (top.status === "fulfilled") {
        lists.push({
          list: "deezer:artist-top",
          tracks: (top.value.data ?? []).map(toSourceTrack),
        });
      }

      if (similar.status === "fulfilled") {
        const artists = (similar.value.data ?? []).filter((entry) => entry.id).slice(0, SIMILAR_ARTISTS);
        const tops = await Promise.allSettled(
          artists.map((entry) =>
            get<{ data?: DeezerTrack[] }>(ctx, `/artist/${entry.id}/top?limit=${TOP_PER_ARTIST}`),
          ),
        );
        const tracks = tops.flatMap((result) =>
          result.status === "fulfilled" ? (result.value.data ?? []).map(toSourceTrack) : [],
        );
        if (tracks.length > 0) lists.push({ list: "deezer:similar-artists", tracks });
      }

      return lists;
    },
  };
}
