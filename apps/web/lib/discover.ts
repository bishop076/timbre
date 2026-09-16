import "server-only";

import { z } from "zod";

import { deezer, deezerList, deezerShelf, rawTrackSchema, type RawTrack } from "./deezer";
import { seededShuffle } from "./rotation";

export interface Genre {
  id: number;
  name: string;
  imageUrl: string | null;
}

export interface ChartTrack {
  id: string;
  title: string;
  artists: string[];
  album: string | null;
  durationMs: number | null;
  isrc: string | null;
  artworkUrl: string | null;
  sources: { source: string; sourceId: string; url: string | null; playback: "link" | "manual" | "queue" }[];
  position: number;
  popularity: number;
}

export interface LinkedSong extends Omit<ChartTrack, "sources" | "position" | "popularity"> {
  sources: { source: string; sourceId: string; url: string | null; playback: "link" }[];
}

interface ChartAlbum {
  id: number;
  title: string;
  artist: string;
  coverUrl: string | null;
  kind: string;
  fresh: boolean;
}

export interface Discover {
  genres: Genre[];
  tracks: ChartTrack[];
  albums: ChartAlbum[];
  artists: { name: string; imageUrl: string | null }[];
  playlists: {
    id: number;
    title: string;
    by: string | null;
    coverUrl: string | null;
    trackCount: number | null;
    covers: string[];
  }[];
}

/**
 * The chart, parsed rather than asserted — every list in it, and every row in every list.
 *
 * All five of these were `interface`s reached through a cast. Deezer answering `200` with
 * `albums.data` as an object rather than a list threw `list is not iterable` out of the loop
 * below, and one row of `null` in `tracks.data` threw `Cannot read properties of null
 * (reading 'id')` in `toTrack`; either is `/explore` rendering its error boundary over a chart
 * that arrived otherwise whole. Rows that fail are dropped, so a chart missing one entry is a
 * chart missing one entry.
 */
const rawAlbumSchema = z.object({
  id: z.number(),
  title: z.string(),
  record_type: z.string().nullish(),
  cover_medium: z.string().nullish(),
  artist: z.object({ name: z.string().nullish() }).nullish(),
});

const chartArtistSchema = z.object({ name: z.string(), picture_medium: z.string().nullish() });

const chartPlaylistSchema = z.object({
  id: z.number(),
  title: z.string(),
  nb_tracks: z.number().nullish(),
  picture_medium: z.string().nullish(),
  picture_big: z.string().nullish(),
  user: z.object({ name: z.string().nullish() }).nullish(),
  creator: z.object({ name: z.string().nullish() }).nullish(),
});

const chartSchema = z.object({
  tracks: deezerShelf(rawTrackSchema),
  albums: deezerShelf(rawAlbumSchema),
  artists: deezerShelf(chartArtistSchema),
  playlists: deezerShelf(chartPlaylistSchema),
});

const genreSchema = z.object({
  id: z.number(),
  name: z.string(),
  picture_medium: z.string().nullish(),
});

function toTrack(raw: RawTrack, index: number): ChartTrack {
  return {
    id: `deezer:${raw.id}`,
    title: raw.title,
    artists: raw.artist?.name ? [raw.artist.name] : [],
    album: raw.album?.title ?? null,
    durationMs: raw.duration ? raw.duration * 1000 : null,
    isrc: null,
    artworkUrl: raw.album?.cover_big ?? raw.album?.cover_medium ?? null,
    sources: [
      {
        source: "deezer",
        sourceId: String(raw.id),
        url: raw.link ?? `https://www.deezer.com/track/${raw.id}`,
        playback: "link",
      },
    ],
    position: raw.position ?? index + 1,
    popularity: raw.rank ?? 0,
  };
}

export function toTrackByOrder(raw: RawTrack, index: number): ChartTrack {
  return { ...toTrack(raw, index), position: index + 1 };
}

export function coversOf(covers: (string | null | undefined)[], max: number): string[] {
  return [...new Set(covers.filter((cover): cover is string => Boolean(cover)))].slice(0, max);
}

export async function fetchGenres(): Promise<Genre[]> {
  const genres = await deezerList("/genre", genreSchema, 604_800);
  return genres.map(({ id, name, picture_medium }) => ({
    id,
    name,
    imageUrl: picture_medium ?? null,
  }));
}

export async function fetchDiscover(genre: number, rotation = 0): Promise<Discover> {
  const [genres, body, picks] = await Promise.all([
    fetchGenres(),
    deezer<unknown>(`/chart/${genre}?limit=25`, 3_600),
    deezerList(`/editorial/${genre}/selection`, rawAlbumSchema, 21_600),
  ]);
  const read = chartSchema.safeParse(body);
  const chart = read.success ? read.data : null;

  const albums = new Map<number, ChartAlbum>();
  for (const [list, fresh] of [
    [picks, true],
    [chart?.albums ?? [], false],
  ] as const) {
    for (const raw of list) {
      if (albums.has(raw.id)) continue;
      albums.set(raw.id, {
        id: raw.id,
        title: raw.title,
        artist: raw.artist?.name ?? "",
        coverUrl: raw.cover_medium ?? null,
        kind: raw.record_type ?? "album",
        fresh,
      });
    }
  }

  const playlists = seededShuffle(chart?.playlists ?? [], rotation * 7 + 3).slice(0, 6);

  return {
    genres,
    tracks: (chart?.tracks ?? []).map(toTrack),
    albums: seededShuffle([...albums.values()], rotation),
    artists: (chart?.artists ?? []).map((raw) => ({
      name: raw.name,
      imageUrl: raw.picture_medium ?? null,
    })),
    playlists: await Promise.all(
      playlists.map(async (playlist) => {
        const tracks = await deezerList(`/playlist/${playlist.id}/tracks?limit=8`, rawTrackSchema);
        return {
          id: playlist.id,
          title: playlist.title,
          by: playlist.creator?.name ?? playlist.user?.name ?? null,
          coverUrl: playlist.picture_big ?? playlist.picture_medium ?? null,
          trackCount: playlist.nb_tracks ?? null,
          covers: coversOf(
            tracks.map((track) => track.album?.cover_medium ?? track.album?.cover_big),
            5,
          ),
        };
      }),
    ),
  };
}
