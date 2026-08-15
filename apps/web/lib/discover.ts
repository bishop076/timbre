import "server-only";

import { deezer } from "./deezer";

/*
 * What Explore is built from: Deezer's charts, genres and editorial, all keyless. One
 * request, not four — `/chart/{genre}` answers with tracks, albums and artists at once,
 * so a genre switch can't half-fail into a state no retry explains.
 */

/** A Deezer genre. `0` is the catalogue-wide chart, which Deezer calls "All". */
export interface Genre {
  id: number;
  name: string;
  imageUrl: string | null;
}

/** A charting song — `<SongCard>`'s shape plus the two chart fields, so the tile needs no second path. */
export interface ChartTrack {
  id: string;
  title: string;
  artists: string[];
  album: string | null;
  durationMs: number | null;
  isrc: string | null;
  artworkUrl: string | null;
  sources: { source: string; sourceId: string; url: string | null; playback: "link" }[];
  position: number;
  /** Deezer's popularity score, 0–1,000,000. Not a play count — label it as a score. */
  popularity: number;
}

export interface ChartAlbum {
  id: number;
  title: string;
  artist: string;
  coverUrl: string | null;
  kind: string;
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
  /** A few of its own track covers — Deezer's single picture makes a card look like one record. */
  covers: string[];
}

export interface Discover {
  genre: number;
  genres: Genre[];
  tracks: ChartTrack[];
  albums: ChartAlbum[];
  artists: ChartArtist[];
  playlists: ChartPlaylist[];
}

interface RawTrack {
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

/** Deezer's genre list, uncurated: it is locale-dependent, so any subset is wrong somewhere. */
function toGenre(raw: { id: number; name: string; picture_medium?: string }): Genre {
  return { id: raw.id, name: raw.name, imageUrl: raw.picture_medium ?? null };
}

function toTrack(raw: RawTrack, index: number): ChartTrack {
  return {
    // Namespaced against merged search results, which key on ISRC or a source pair.
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
        // Deezer audio can't be played here; picking one searches for a copy.
        playback: "link",
      },
    ],
    // Absent from some genre charts, and array order is the ranking — so index, not 0.
    position: raw.position ?? index + 1,
    popularity: raw.rank ?? 0,
  };
}

export async function fetchGenres(): Promise<Genre[]> {
  const data = await deezer<{ data?: { id: number; name: string; picture_medium?: string }[] }>(
    "/genre",
    // Genres change about once a decade.
    604_800,
  );
  return (data?.data ?? []).map(toGenre);
}

/** A genre's chart and the genre list. Cached an hour — charts move daily at best. */
export async function fetchDiscover(genre: number): Promise<Discover> {
  const [genres, chart] = await Promise.all([
    fetchGenres(),
    deezer<RawChart>(`/chart/${genre}?limit=25`, 3_600),
  ]);

  return {
    genre,
    genres,
    tracks: (chart?.tracks?.data ?? []).map(toTrack),
    albums: (chart?.albums?.data ?? []).map((raw) => ({
      id: raw.id,
      title: raw.title,
      artist: raw.artist?.name ?? "",
      coverUrl: raw.cover_medium ?? null,
      kind: raw.record_type ?? "album",
    })),
    artists: (chart?.artists?.data ?? []).map((raw) => ({
      name: raw.name,
      imageUrl: raw.picture_medium ?? null,
    })),
    playlists: await withCovers((chart?.playlists?.data ?? []).slice(0, 6)),
  };
}

/**
 * Playlists carrying a few of their own sleeves. One extra request each, capped at six and
 * cached a day; `limit=8` because a collage shows four covers. A failure costs the scatter.
 */
async function withCovers(raw: RawPlaylist[]): Promise<ChartPlaylist[]> {
  return Promise.all(
    raw.map(async (playlist) => {
      const tracks = await deezer<{ data?: RawTrack[] }>(
        `/playlist/${playlist.id}/tracks?limit=8`,
        86_400,
      );

      const covers = new Set<string>();
      for (const track of tracks?.data ?? []) {
        const cover = track.album?.cover_medium ?? track.album?.cover_big;
        if (cover) covers.add(cover);
        if (covers.size === 5) break;
      }

      return {
        id: playlist.id,
        title: playlist.title,
        by: playlist.creator?.name ?? playlist.user?.name ?? null,
        coverUrl: playlist.picture_big ?? playlist.picture_medium ?? null,
        trackCount: playlist.nb_tracks ?? null,
        covers: [...covers],
      };
    }),
  );
}
