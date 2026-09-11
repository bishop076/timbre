import "server-only";

import { deezer } from "./deezer";
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

export interface ChartAlbum {
  id: number;
  title: string;
  artist: string;
  coverUrl: string | null;
  kind: string;
  fresh: boolean;
}

export interface ChartArtist {
  name: string;
  imageUrl: string | null;
}

export interface ChartPlaylist {
  id: number;
  title: string;
  by: string | null;
  coverUrl: string | null;
  trackCount: number | null;
  covers: string[];
}

export interface Discover {
  genres: Genre[];
  tracks: ChartTrack[];
  albums: ChartAlbum[];
  artists: ChartArtist[];
  playlists: ChartPlaylist[];
}

export interface RawTrack {
  id: number;
  title: string;
  duration?: number;
  rank?: number;
  position?: number;
  link?: string;
  artist?: { name?: string };
  album?: { title?: string; cover_medium?: string; cover_big?: string };
}

interface RawAlbum {
  id: number;
  title: string;
  record_type?: string;
  cover_medium?: string;
  artist?: { name?: string };
}

interface RawArtist {
  name: string;
  picture_medium?: string;
}

interface RawPlaylist {
  id: number;
  title: string;
  nb_tracks?: number;
  picture_medium?: string;
  picture_big?: string;
  user?: { name?: string };
  creator?: { name?: string };
}

interface RawChart {
  tracks?: { data?: RawTrack[] };
  albums?: { data?: RawAlbum[] };
  artists?: { data?: RawArtist[] };
  playlists?: { data?: RawPlaylist[] };
}

function toGenre(raw: { id: number; name: string; picture_medium?: string }): Genre {
  return { id: raw.id, name: raw.name, imageUrl: raw.picture_medium ?? null };
}

export function toTrack(raw: RawTrack, index: number): ChartTrack {
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
  const seen = new Set<string>();
  for (const cover of covers) {
    if (cover) seen.add(cover);
    if (seen.size === max) break;
  }
  return [...seen];
}

export async function fetchGenres(): Promise<Genre[]> {
  const data = await deezer<{ data?: { id: number; name: string; picture_medium?: string }[] }>(
    "/genre",
    604_800,
  );
  return (data?.data ?? []).map(toGenre);
}

export async function fetchDiscover(genre: number, rotation = 0): Promise<Discover> {
  const [genres, chart, picks] = await Promise.all([
    fetchGenres(),
    deezer<RawChart>(`/chart/${genre}?limit=25`, 3_600),
    deezer<{ data?: RawAlbum[] }>(`/editorial/${genre}/selection`, 21_600),
  ]);

  const seen = new Set<number>();
  const albums: { raw: RawAlbum; fresh: boolean }[] = [];
  for (const [list, fresh] of [
    [picks?.data ?? [], true],
    [chart?.albums?.data ?? [], false],
  ] as const) {
    for (const raw of list) {
      if (seen.has(raw.id)) continue;
      seen.add(raw.id);
      albums.push({ raw, fresh });
    }
  }

  return {
    genres,
    tracks: (chart?.tracks?.data ?? []).map(toTrack),
    albums: seededShuffle(albums, rotation).map(({ raw, fresh }) => ({
      id: raw.id,
      title: raw.title,
      artist: raw.artist?.name ?? "",
      coverUrl: raw.cover_medium ?? null,
      kind: raw.record_type ?? "album",
      fresh,
    })),
    artists: (chart?.artists?.data ?? []).map((raw) => ({
      name: raw.name,
      imageUrl: raw.picture_medium ?? null,
    })),
    playlists: await withCovers(
      seededShuffle(chart?.playlists?.data ?? [], rotation * 7 + 3).slice(0, 6),
    ),
  };
}

async function withCovers(raw: RawPlaylist[]): Promise<ChartPlaylist[]> {
  return Promise.all(
    raw.map(async (playlist) => {
      const tracks = await deezer<{ data?: RawTrack[] }>(
        `/playlist/${playlist.id}/tracks?limit=8`,
        86_400,
      );

      return {
        id: playlist.id,
        title: playlist.title,
        by: playlist.creator?.name ?? playlist.user?.name ?? null,
        coverUrl: playlist.picture_big ?? playlist.picture_medium ?? null,
        trackCount: playlist.nb_tracks ?? null,
        covers: coversOf(
          (tracks?.data ?? []).map((track) => track.album?.cover_medium ?? track.album?.cover_big),
          5,
        ),
      };
    }),
  );
}
