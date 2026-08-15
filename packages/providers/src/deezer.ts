// Deezer. No authentication, and alone among the free sources its search results carry
// **ISRCs** — which is what lets Timbre say two results are the same recording, since
// YouTube Music exposes none. Audio is unplayable here, so tracks are `link`.

import { DEFAULT_POLICIES, ProviderError } from "@timbre/core";

import type {
  RankedList,
  SearchContext,
  SearchProvider,
  SourceTrack,
} from "./types.ts";
import { cachePolicy } from "./cache-policy.ts";

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

interface DeezerArtist {
  id?: number;
  name: string;
}

// How far the similar-artist leg reaches. Deezer orders similar artists by confidence, so
// the tail buys little variety, and every extra artist is another round trip on the
// critical path of a track change.
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
    isExplicit: Boolean(raw.explicit_lyrics),
  };
}

export function createDeezerProvider(): SearchProvider {
  async function get<T>(ctx: SearchContext, path: string): Promise<T> {
    await ctx.limiter.acquire("deezer", DEFAULT_POLICIES.deezer);

    let response: Response;
    try {
      response = await fetch(`${API}${path}`, { signal: ctx.signal, ...cachePolicy(ctx) });
    } catch (cause) {
      throw new ProviderError("deezer", "transient", "Deezer unreachable.", { cause });
    }

    if (!response.ok) {
      throw new ProviderError("deezer", "transient", `Deezer returned ${response.status}.`, {
        status: response.status,
      });
    }

    const body = (await response.json()) as T & { error?: { message?: string } };
    // Quota and validation failures arrive in a **200 body**, not a status code.
    if (body && typeof body === "object" && "error" in body && body.error) {
      throw new ProviderError("deezer", "transient", body.error.message ?? "Deezer error.");
    }
    return body;
  }

  /** Finds an artist by exact name — the search is fuzzy and returns tribute acts and
   * similarly-named producers, so only a case-insensitive exact match passes. */
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

    // Deezer's second opinion: the seed artist's top tracks, plus those of similar
    // artists. Only an **artist** can seed it — `/track/{id}/related` is not a route and
    // answers InvalidQueryException 600. And `/top`, not `/radio`: seeded on *As It Was*,
    // artist radio shared zero tracks with YouTube Music's lists while top tracks shared
    // six, and a list nothing agrees with cannot build a consensus.
    async radio(ctx, seed, limit): Promise<RankedList[]> {
      if (!seed.artist) return [];

      const match = await findArtist(ctx, seed.artist);
      if (!match?.id) return [];

      // The ranker treats a missing list as an abstention, not evidence against.
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
        // Deezer's bucket is capacity 20 at 8/s, so these fit in one burst.
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
