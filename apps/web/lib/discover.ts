import "server-only";

import { deezer, deezerList, type RawTrack } from "./deezer";
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

interface RawAlbum {
  id: number;
  title: string;
  record_type?: string;
  cover_medium?: string;
  artist?: { name?: string };
}

interface RawChart {
  tracks?: { data?: RawTrack[] };
  albums?: { data?: RawAlbum[] };
  artists?: { data?: { name: string; picture_medium?: string }[] };
  playlists?: {
    data?: {
      id: number;
      title: string;
      nb_tracks?: number;
      picture_medium?: string;
      picture_big?: string;
      user?: { name?: string };
      creator?: { name?: string };
    }[];
  };
}

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
  const genres = await deezerList<{ id: number; name: string; picture_medium?: string }>(
    "/genre",
    604_800,
  );
  return genres.map(({ id, name, picture_medium }) => ({
    id,
    name,
    imageUrl: picture_medium ?? null,
  }));
}

export async function fetchDiscover(genre: number, rotation = 0): Promise<Discover> {
  const [genres, chart, picks] = await Promise.all([
    fetchGenres(),
    deezer<RawChart>(`/chart/${genre}?limit=25`, 3_600),
    deezerList<RawAlbum>(`/editorial/${genre}/selection`, 21_600),
  ]);

  const albums = new Map<number, ChartAlbum>();
  for (const [list, fresh] of [
    [picks, true],
    [chart?.albums?.data ?? [], false],
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

  const playlists = seededShuffle(chart?.playlists?.data ?? [], rotation * 7 + 3).slice(0, 6);

  return {
    genres,
    tracks: (chart?.tracks?.data ?? []).map(toTrack),
    albums: seededShuffle([...albums.values()], rotation),
    artists: (chart?.artists?.data ?? []).map((raw) => ({
      name: raw.name,
      imageUrl: raw.picture_medium ?? null,
    })),
    playlists: await Promise.all(
      playlists.map(async (playlist) => {
        const tracks = await deezerList<RawTrack>(`/playlist/${playlist.id}/tracks?limit=8`);
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
