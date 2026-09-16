import "server-only";

import { z } from "zod";

import {
  deezerOrFail,
  DeezerUnavailable,
  deezerRows,
  newestFirst,
  rawTrackSchema,
} from "./deezer";
import { toTrackByOrder, type ChartTrack } from "./discover";
import { log, scrub } from "./log";
import { DEEZER_AT_ONCE, mapPool } from "./pool";
import { currentRotation, interleaveBy, seededShuffle } from "./rotation";

const STATION_PERIOD_MS = 15 * 60 * 1000;

/**
 * Whether anything behind this feed failed rather than simply came back empty.
 *
 * `deezer()` forgives every outage into `null` and `deezerList` into `[]`, so "this genre has
 * nothing fresh in it" and "Deezer is rate limiting this deployment" reach the caller as the
 * same value — and `/api/genre-feed` then pinned whichever it got behind fifteen minutes of
 * `s-maxage` with an hour of stale-while-revalidate over the top. `mapPool` made tripping the
 * quota much less likely, which is the cause; the cache is what turns one blip into an hour of
 * an empty shelf, and that half was never fixed. A caller holding a probe can tell the two
 * apart and refuse to let a degraded answer be remembered. Callers that pass none —
 * `lib/collection.ts` — behave exactly as they did.
 */
export interface FeedProbe {
  failed: boolean;
}

async function read<T>(
  path: string,
  revalidateSeconds: number | undefined,
  probe: FeedProbe | undefined,
): Promise<T | null> {
  try {
    return await deezerOrFail<T>(path, revalidateSeconds);
  } catch (cause) {
    if (!(cause instanceof DeezerUnavailable)) throw cause;
    log("warn", "deezer_unavailable", { path, message: scrub(cause.message) });
    if (probe) probe.failed = true;
    return null;
  }
}

/** Forgiving like `read` above, and parsed: a body that is not a list of rows is no rows. */
async function readList<T>(
  path: string,
  row: z.ZodType<T>,
  revalidateSeconds: number | undefined,
  probe: FeedProbe | undefined,
): Promise<T[]> {
  const parsed = deezerRows(row).safeParse(await read<unknown>(path, revalidateSeconds, probe));
  return parsed.success ? parsed.data : [];
}

/**
 * The feed's rows, parsed rather than asserted.
 *
 * `drawStations` reads `raw.title.trim()` on every station Deezer lists for a genre, and this
 * was an `interface` and a cast: one station row with no `title` threw
 * `Cannot read properties of undefined (reading 'trim')`, which is `/api/genre-feed` answering
 * `500` and `/collection/genre/<id>` rendering its error boundary. A station Deezer sent that
 * this cannot read is now one station fewer in the draw.
 */
const rawAlbumSchema = z.object({
  id: z.number(),
  title: z.string(),
  release_date: z.string().nullish(),
  cover_medium: z.string().nullish(),
  cover_big: z.string().nullish(),
  tracks: deezerRows(rawTrackSchema).nullish(),
});

type RawAlbum = z.output<typeof rawAlbumSchema>;

const selectionSchema = z.object({ id: z.number(), genre_id: z.number().nullish() });

const stationSchema = z.object({ id: z.number(), title: z.string() });

export async function fetchFresh(genre: number, probe?: FeedProbe): Promise<ChartTrack[]> {
  const selection = await readList(`/editorial/${genre}/selection`, selectionSchema, 21_600, probe);
  const picks = selection.filter((album) => genre === 0 || album.genre_id === genre);
  // One page request used to become twenty-odd album lookups at once, none of them queued.
  // See `mapPool` for why that is how a genre page ends up cached empty for fifteen minutes.
  const albums = await mapPool(picks, DEEZER_AT_ONCE, async (pick) => {
    const parsed = rawAlbumSchema.safeParse(await read<unknown>(`/album/${pick.id}`, undefined, probe));
    return parsed.success ? parsed.data : null;
  });

  return albums
    .filter((album): album is RawAlbum => Boolean(album?.tracks?.length))
    .sort(newestFirst)
    .flatMap(({ title, cover_medium, cover_big, tracks }) =>
      (tracks ?? [])
        .toSorted((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
        .slice(0, 2)
        .map((track) => ({ ...track, album: { title, cover_medium, cover_big } })),
    )
    .map(toTrackByOrder);
}

export async function drawStations(genre: number, probe?: FeedProbe) {
  const radios = await readList(`/genre/${genre}/radios`, stationSchema, undefined, probe);
  const all = radios.map((raw) => ({ id: raw.id, title: raw.title.trim() }));
  const stations = seededShuffle(all, currentRotation(STATION_PERIOD_MS) * 31 + genre).slice(0, 3);
  const lists = await mapPool(stations, DEEZER_AT_ONCE, (station) => drawStation(station.id, probe));

  return {
    stations: stations.filter((_, index) => lists[index]!.length > 0),
    tracks: interleaveBy(lists, (track) => track.id, 60).map((track, index) => ({
      ...track,
      position: index + 1,
    })),
  };
}

export async function drawStation(id: number, probe?: FeedProbe): Promise<ChartTrack[]> {
  const list = await readList(`/radio/${id}/tracks`, rawTrackSchema, STATION_PERIOD_MS / 1000, probe);
  return list.slice(0, 100).map(toTrackByOrder);
}
