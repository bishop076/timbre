import "server-only";

import { deezer } from "./deezer";
import { toTrackByOrder, type ChartTrack, type RawTrack } from "./discover";
import { interleaveBy, rotationBucket, seededShuffle } from "./rotation";

export interface GenreStation {
  id: number;
  title: string;
}

export const STATION_PERIOD_MS = 15 * 60 * 1000;

const STATIONS_PER_DRAW = 3;

interface RawSelectionAlbum {
  id: number;
  genre_id?: number;
}

interface RawAlbum {
  id: number;
  title: string;
  release_date?: string;
  cover_medium?: string;
  cover_big?: string;
  tracks?: { data?: RawTrack[] };
}

export async function fetchGenreStations(genre: number): Promise<GenreStation[]> {
  if (genre <= 0) return [];
  const data = await deezer<{ data?: { id: number; title: string }[] }>(
    `/genre/${genre}/radios`,
    86_400,
  );
  return (data?.data ?? []).map((raw) => ({ id: raw.id, title: raw.title.trim() }));
}

export async function fetchFresh(genre: number, perAlbum = 2): Promise<ChartTrack[]> {
  const selection = await deezer<{ data?: RawSelectionAlbum[] }>(
    `/editorial/${genre}/selection`,
    21_600,
  );

  const picks = (selection?.data ?? []).filter(
    (album) => genre === 0 || album.genre_id === genre,
  );

  const albums = (
    await Promise.all(picks.map((pick) => deezer<RawAlbum>(`/album/${pick.id}`)))
  ).filter((album): album is RawAlbum => Boolean(album?.tracks?.data?.length));

  albums.sort((a, b) => (b.release_date ?? "").localeCompare(a.release_date ?? ""));

  const tracks: RawTrack[] = [];
  for (const album of albums) {
    const sleeve = { title: album.title, cover_medium: album.cover_medium, cover_big: album.cover_big };
    const best = (album.tracks?.data ?? [])
      .slice()
      .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
      .slice(0, perAlbum);
    for (const track of best) tracks.push({ ...track, album: sleeve });
  }

  return tracks.map(toTrackByOrder);
}

export async function drawStations(
  genre: number,
  now = Date.now(),
): Promise<{ stations: GenreStation[]; tracks: ChartTrack[] }> {
  const all = await fetchGenreStations(genre);
  if (all.length === 0) return { stations: [], tracks: [] };

  const stations = seededShuffle(all, rotationBucket(now, STATION_PERIOD_MS) * 31 + genre).slice(
    0,
    STATIONS_PER_DRAW,
  );
  const lists = await Promise.all(stations.map((station) => drawStation(station.id)));

  return {
    stations: stations.filter((_, index) => lists[index]!.length > 0),
    tracks: interleaveBy(lists, (track) => track.id, 60).map((track, index) => ({
      ...track,
      position: index + 1,
    })),
  };
}

export async function drawStation(id: number): Promise<ChartTrack[]> {
  const list = await deezer<{ data?: RawTrack[] }>(
    `/radio/${id}/tracks`,
    STATION_PERIOD_MS / 1000,
  );
  return (list?.data ?? []).slice(0, 100).map(toTrackByOrder);
}

export async function genreOfStation(
  id: number,
): Promise<{ id: number; name: string } | null> {
  const data = await deezer<{ data?: { id: number; title: string; radios?: { id: number }[] }[] }>(
    "/radio/genres",
    86_400,
  );
  const group = (data?.data ?? []).find((entry) =>
    (entry.radios ?? []).some((radio) => radio.id === id),
  );
  return group && group.id > 0 ? { id: group.id, name: group.title } : null;
}
