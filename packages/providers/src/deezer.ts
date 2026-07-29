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

import type {
  ArtistInfo,
  RankedList,
  SearchContext,
  SearchProvider,
  SourceTrack,
} from "./types.ts";

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
  link?: string;
  picture_medium?: string;
  picture_big?: string;
  picture_xl?: string;
  /** Deezer calls followers "fans". */
  nb_fan?: number;
}

/**
 * How far the similar-artist leg reaches.
 *
 * Three artists at five tracks each is fifteen candidates for three requests.
 * Going wider buys diminishing variety — Deezer orders similar artists by
 * confidence, and the tail is noticeably less similar — while every extra
 * artist is another round trip on the critical path of a track change.
 */
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

  /**
   * Finds an artist by exact name.
   *
   * Deezer's artist search is fuzzy and will happily return a tribute act or a
   * similarly-named producer, so only an exact case-insensitive name match is
   * accepted. Shared by the artist card and the radio, which both start from
   * nothing but a name — YouTube Music carries no Deezer ids.
   */
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

    /**
     * Deezer is the only free source that publishes artist pictures and a
     * follower count without a key, which is what makes an "about the artist"
     * panel possible at all.
     *
     * Matched on name, because that is all a track from YouTube Music carries —
     * so the first result is accepted only when the names agree, rather than
     * showing a photo of whoever Deezer thought was closest.
     */
    async artist(ctx, name): Promise<ArtistInfo | null> {
      const match = await findArtist(ctx, name);
      if (!match) return null;

      return {
        name: match.name,
        imageUrl: match.picture_xl ?? match.picture_big ?? match.picture_medium ?? null,
        followers: typeof match.nb_fan === "number" ? match.nb_fan : null,
        source: "deezer",
        url: match.link ?? null,
      };
    },

    /**
     * Deezer's second opinion.
     *
     * Deezer can only start from an **artist**: `/track/{id}/related` is not a
     * route on its API (it answers InvalidQueryException 600), so there is no
     * track-level continuation to ask for. Two lists come out of that:
     *
     *   - the seed artist's top tracks, which is what overlaps with what other
     *     services push and therefore where agreement can be measured
     *   - the top tracks of artists Deezer considers similar, which is the only
     *     list here that reaches *away* from the seed's own catalogue
     *
     * `/artist/{id}/top` rather than `/artist/{id}/radio`, and that choice was
     * measured. Seeded on *As It Was*, Deezer's artist radio shared **zero**
     * tracks with YouTube Music's two lists — it is a deep-cuts feed, returning
     * things like "Taste Back" and "Are You Listening Yet" that no other source
     * surfaces. Its top tracks shared six. A list nothing else ever agrees with
     * cannot contribute to a consensus score; it only adds noise for the artist
     * spacing pass to sort out.
     *
     * Neither can be played by Timbre directly — Deezer tracks are `link` — so
     * these earn their place by *agreeing* with YouTube Music's lists and
     * lifting shared songs, and by widening the pool when they do not. A Deezer
     * song that survives ranking is resolved to a playable copy at play time by
     * the player's existing search fall-back.
     */
    async radio(ctx, seed, limit): Promise<RankedList[]> {
      if (!seed.artist) return [];

      const match = await findArtist(ctx, seed.artist);
      if (!match?.id) return [];

      // Both legs are independent, and either failing is survivable: a missing
      // list is an abstention, and the ranker treats it as no evidence rather
      // than as evidence against.
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
        // A few small requests in parallel rather than one large sequential
        // walk. Deezer's bucket is capacity 20 at 8/s, so this fits inside one
        // burst; the limiter serialises them if it does not.
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
