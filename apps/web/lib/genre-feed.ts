import "server-only";

import { deezer } from "./deezer";
import { toTrackByOrder, type ChartTrack, type RawTrack } from "./discover";
import { interleaveBy, rotationBucket, seededShuffle } from "./rotation";

/*
 * What is in a genre *now*, as opposed to what charts in it. Deezer's `/chart/{genre}` is
 * the catalogue's popularity with a loose genre filter — measured 2026-09-10, its Rock chart
 * opened with Sleeping At Last and Mariah The Scientist — and it moves weekly, so a genre
 * page built on it alone showed the same pop songs every visit. Two other keyless sources
 * are genre-true and move far faster:
 *
 * - **Editors' picks**, `/editorial/{genre}/selection`: ten albums, each carrying the
 *   `genre_id` Deezer filed it under, so an off-genre pick is dropped without a lookup.
 *   `/editorial/{genre}/releases` would be the obvious source and returns `total: 0` for
 *   every genre — it is dead.
 * - **The genre's stations**, `/genre/{genre}/radios`: eighteen for Rock. Each answers with a
 *   fresh random draw on every call, so the only thing that ever froze them was our cache.
 */

export interface GenreStation {
  id: number;
  title: string;
}

/** How long one draw of a genre's stations stands, and how often a different trio is picked. */
export const STATION_PERIOD_MS = 15 * 60 * 1000;

/** How many of a genre's stations one draw takes songs from. */
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

/** A genre's stations, in Deezer's order. */
export async function fetchGenreStations(genre: number): Promise<GenreStation[]> {
  if (genre <= 0) return [];
  const data = await deezer<{ data?: { id: number; title: string }[] }>(
    `/genre/${genre}/radios`,
    86_400,
  );
  return (data?.data ?? []).map((raw) => ({ id: raw.id, title: raw.title.trim() }));
}

/**
 * The editors' picks for a genre, newest release first, two songs from each. Only albums
 * Deezer files under the genre itself: the selection for Rock carries Alternative albums
 * too, and a Rock page is not where those belong. `0` has no genre to check, so keeps all.
 */
export async function fetchFresh(genre: number, perAlbum = 2): Promise<ChartTrack[]> {
  const selection = await deezer<{ data?: RawSelectionAlbum[] }>(
    `/editorial/${genre}/selection`,
    // Editors change it a few times a week; six hours notices within a day.
    21_600,
  );

  const picks = (selection?.data ?? []).filter(
    (album) => genre === 0 || album.genre_id === genre,
  );

  // `/album/{id}` with the default day, shared with the album page's own lookup.
  const albums = (
    await Promise.all(picks.map((pick) => deezer<RawAlbum>(`/album/${pick.id}`)))
  ).filter((album): album is RawAlbum => Boolean(album?.tracks?.data?.length));

  albums.sort((a, b) => (b.release_date ?? "").localeCompare(a.release_date ?? ""));

  const tracks: RawTrack[] = [];
  for (const album of albums) {
    // An album's own tracks come without its sleeve; this puts it back.
    const sleeve = { title: album.title, cover_medium: album.cover_medium, cover_big: album.cover_big };
    const best = (album.tracks?.data ?? [])
      .slice()
      // Deezer's popularity, so a pick opens on the song people actually play from it.
      .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
      .slice(0, perAlbum);
    for (const track of best) tracks.push({ ...track, album: sleeve });
  }

  return tracks.map(toTrackByOrder);
}

/**
 * Songs from a few of a genre's stations, round-robin. Which few is decided by the clock —
 * `STATION_PERIOD_MS` at a time — so consecutive visits hear different stations, not only
 * different draws of the same three.
 */
export async function drawStations(
  genre: number,
  now = Date.now(),
): Promise<{ stations: GenreStation[]; tracks: ChartTrack[] }> {
  const all = await fetchGenreStations(genre);
  if (all.length === 0) return { stations: [], tracks: [] };

  // The genre is mixed into the seed, or every genre would rotate in lockstep.
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

/** One station's current draw. Cached for the period, not an hour: every call is new songs. */
export async function drawStation(id: number): Promise<ChartTrack[]> {
  const list = await deezer<{ data?: RawTrack[] }>(
    `/radio/${id}/tracks`,
    STATION_PERIOD_MS / 1000,
  );
  return (list?.data ?? []).slice(0, 100).map(toTrackByOrder);
}

/** A station's genre, from the taxonomy Explore's stations row is built from. */
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
