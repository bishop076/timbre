import "server-only";

import { deezer, deezerList, newestFirst, type RawTrack } from "./deezer";
import { toTrackByOrder, type ChartTrack } from "./discover";
import { mapPool } from "./pool";
import { currentRotation, interleaveBy, seededShuffle } from "./rotation";

const STATION_PERIOD_MS = 15 * 60 * 1000;

/** Deezer's own bucket in `packages/core` allows 20 with an 8/s refill; stay well under it. */
const DEEZER_AT_ONCE = 5;

interface RawAlbum {
  id: number;
  title: string;
  release_date?: string;
  cover_medium?: string;
  cover_big?: string;
  tracks?: { data?: RawTrack[] };
}

export async function fetchFresh(genre: number): Promise<ChartTrack[]> {
  const selection = await deezerList<{ id: number; genre_id?: number }>(
    `/editorial/${genre}/selection`,
    21_600,
  );
  const picks = selection.filter((album) => genre === 0 || album.genre_id === genre);
  // One page request used to become twenty-odd album lookups at once, none of them queued.
  // See `mapPool` for why that is how a genre page ends up cached empty for fifteen minutes.
  const albums = await mapPool(picks, DEEZER_AT_ONCE, (pick) =>
    deezer<RawAlbum>(`/album/${pick.id}`),
  );

  return albums
    .filter((album): album is RawAlbum => Boolean(album?.tracks?.data?.length))
    .sort(newestFirst)
    .flatMap(({ title, cover_medium, cover_big, tracks }) =>
      (tracks?.data ?? [])
        .toSorted((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
        .slice(0, 2)
        .map((track) => ({ ...track, album: { title, cover_medium, cover_big } })),
    )
    .map(toTrackByOrder);
}

export async function drawStations(genre: number) {
  const radios = await deezerList<{ id: number; title: string }>(`/genre/${genre}/radios`);
  const all = radios.map((raw) => ({ id: raw.id, title: raw.title.trim() }));
  const stations = seededShuffle(all, currentRotation(STATION_PERIOD_MS) * 31 + genre).slice(0, 3);
  const lists = await mapPool(stations, DEEZER_AT_ONCE, (station) => drawStation(station.id));

  return {
    stations: stations.filter((_, index) => lists[index]!.length > 0),
    tracks: interleaveBy(lists, (track) => track.id, 60).map((track, index) => ({
      ...track,
      position: index + 1,
    })),
  };
}

export async function drawStation(id: number): Promise<ChartTrack[]> {
  const list = await deezerList<RawTrack>(`/radio/${id}/tracks`, STATION_PERIOD_MS / 1000);
  return list.slice(0, 100).map(toTrackByOrder);
}
