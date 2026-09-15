import { artistKey } from "../../lib/genre-tally.ts";
import type { PlayedSong } from "../player/history-store";
import { loggedSong, PLAY_LOG_LIMIT, type PlayLog } from "./play-log.ts";

export interface Play {
  song: PlayedSong;
  at: number | null;
}

export function playsFrom(
  log: PlayLog,
  history: readonly PlayedSong[],
  limit = PLAY_LOG_LIMIT,
): Play[] {
  const plays: Play[] = log.plays.flatMap(([id, at]) => {
    const song = loggedSong(log, id);
    return song ? [{ song, at }] : [];
  });
  if (log.plays.length >= limit) return plays;

  for (const entry of history) {
    if (!loggedSong(log, entry.id)) plays.push({ song: entry, at: null });
  }
  return plays;
}

export interface ListeningStats {
  total: number;
  dated: number;
  undated: number;
  first: number | null;
  last: number | null;
  /** Calendar days from the first dated play to the last, both included. */
  days: number;
  /** How many of those days had something playing — the interesting half of `days`. */
  activeDays: number;
  artists: { key: string; name: string; plays: number; songs: number }[];
  songs: { song: PlayedSong; plays: number }[];
  weekdays: number[];
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function artistsOf(song: PlayedSong): string[] {
  const names: unknown = song.artists;
  if (!Array.isArray(names)) return [];
  return names.flatMap((name) => (typeof name === "string" && name.trim() ? [name.trim()] : []));
}

function dayOf(at: number): number {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function listeningStats(plays: readonly Play[]): ListeningStats {
  const artists = new Map<string, { name: string; plays: number; songs: Set<string> }>();
  const songs = new Map<string, ListeningStats["songs"][number]>();
  const weekdays = [0, 0, 0, 0, 0, 0, 0];
  const active = new Set<number>();
  let dated = 0;
  let first: number | null = null;
  let last: number | null = null;

  for (const { song, at } of plays) {
    const counted = songs.get(song.id) ?? { song, plays: 0 };
    counted.plays += 1;
    songs.set(song.id, counted);

    const credited = new Set<string>();
    for (const name of artistsOf(song)) {
      // `artistKey` used to strip a name to letters and digits, which left "!!!" and "†††" with
      // nothing, and an empty key made every such act the same act. It falls back to the folded
      // name itself now, so the `|| name.toLowerCase()` that used to stand in for that here is
      // gone — and with it the chance of the two call sites disagreeing about one artist.
      const key = artistKey(name);
      if (credited.has(key)) continue;
      credited.add(key);

      const artist = artists.get(key) ?? { name, plays: 0, songs: new Set<string>() };
      artist.plays += 1;
      artist.songs.add(song.id);
      artists.set(key, artist);
    }

    if (at !== null) {
      dated += 1;
      if (first === null || at < first) first = at;
      if (last === null || at > last) last = at;
      weekdays[(new Date(at).getDay() + 6) % 7] += 1;
      active.add(dayOf(at));
    }
  }

  return {
    total: plays.length,
    dated,
    undated: plays.length - dated,
    first,
    last,
    days:
      first === null || last === null
        ? 0
        : Math.round((dayOf(last) - dayOf(first)) / 86_400_000) + 1,
    activeDays: active.size,
    artists: [...artists]
      .sort(([, a], [, b]) => b.plays - a.plays || b.songs.size - a.songs.size)
      .map(([key, artist]) => ({ key, ...artist, songs: artist.songs.size })),
    songs: [...songs.values()].sort((a, b) => b.plays - a.plays),
    weekdays,
  };
}

/* ---------------------------------------------------------------------------
   Periods

   Every figure above counts the whole log. "Your top artist" over a log reaching
   back months is a fact about the past, not about what you are playing now —
   which is the thing most people open this page for. A period is a filter over
   the plays, applied before anything is counted, so every number on the page
   moves together and none of them can disagree about what it is describing.
   --------------------------------------------------------------------------- */

export interface Period {
  key: string;
  /** Names the period on its own, for a label a reader hears out of context. */
  label: string;
  /** Names it inside a row of its siblings, where "the last" is repeated noise. */
  short: string;
  /** Calendar days back from today, today included. `null` is everything. */
  days: number | null;
}

export const PERIODS: readonly Period[] = [
  { key: "7", label: "The last 7 days", short: "7 days", days: 7 },
  { key: "30", label: "The last 30 days", short: "30 days", days: 30 },
  { key: "all", label: "All time", short: "All time", days: null },
];

export const DEFAULT_PERIOD: Period = PERIODS[1]!;

export function periodByKey(key: string | null | undefined): Period {
  return PERIODS.find((period) => period.key === key) ?? DEFAULT_PERIOD;
}

function startOfDay(at: number): Date {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysBefore(now: number, days: number): number {
  const from = startOfDay(now);
  from.setDate(from.getDate() - (days - 1));
  return from.getTime();
}

/**
 * The plays inside a period, measured in calendar days rather than in multiples of 86,400,000.
 *
 * The two differ twice a year: counting back seven 24-hour blocks across a clock change lands an
 * hour inside the eighth day, and a day's plays appear or vanish for no reason the listener can
 * see. `Date` knows where the local boundaries are; arithmetic on the epoch does not.
 *
 * A play from before Timbre kept times has no date, so it cannot be shown to be inside a bounded
 * period — it counts only under "all time", where the caption explains what it is.
 */
export function playsWithin(
  plays: readonly Play[],
  days: number | null,
  now: number = Date.now(),
): Play[] {
  if (days === null) return [...plays];

  const cutoff = daysBefore(now, days);
  return plays.filter((play) => play.at !== null && play.at >= cutoff);
}

/* ---------------------------------------------------------------------------
   Listening over time
   --------------------------------------------------------------------------- */

export type Grain = "day" | "week" | "month";

export interface Bucket {
  key: string;
  /** The whole name — "Monday 8 Sept" — for the tooltip and the table. */
  label: string;
  /** What is printed under the column, thinned so thirty of them stay readable. */
  axis: string;
  plays: number;
}

export interface Timeline {
  buckets: Bucket[];
  grain: Grain;
  /** Plays with no date, which no bucket can hold. */
  undated: number;
}

/** How many axis labels survive the thinning, anchored on the newest column. */
const AXIS_LABELS = 8;

function startOfGrain(grain: Grain, at: number): number {
  const date = new Date(at);
  if (grain === "month") return new Date(date.getFullYear(), date.getMonth(), 1).getTime();

  const day = startOfDay(at);
  // Back to Monday, matching WEEKDAYS.
  if (grain === "week") day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day.getTime();
}

function advance(grain: Grain, from: number): number {
  const next = new Date(from);
  if (grain === "day") next.setDate(next.getDate() + 1);
  else if (grain === "week") next.setDate(next.getDate() + 7);
  else next.setMonth(next.getMonth() + 1);
  return next.getTime();
}

function nameBucket(grain: Grain, from: number): { label: string; axis: string } {
  const date = new Date(from);

  if (grain === "month") {
    return {
      label: date.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
      axis: date.toLocaleDateString(undefined, { month: "short" }),
    };
  }

  const short = date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  if (grain === "week") return { label: `Week of ${short}`, axis: short };

  return {
    label: date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" }),
    axis: short,
  };
}

/**
 * How far apart the columns stand. A day each over a week or a month, then coarser, so the chart
 * never asks a 600px panel for a column per day of a year.
 */
function grainFor(days: number | null, span: number): Grain {
  if (days !== null || span <= 35) return "day";
  return span <= 200 ? "week" : "month";
}

/**
 * Plays per day, week or month across the period — including the quiet ones.
 *
 * The gaps are the information here. Binning only the days that have a play draws a chart where
 * every column is tall and the axis is a lie, so this walks the whole range from its first
 * boundary to today and keeps the empty buckets.
 */
export function playsOverTime(
  plays: readonly Play[],
  days: number | null,
  now: number = Date.now(),
): Timeline {
  const dated: number[] = [];
  for (const play of plays) if (play.at !== null) dated.push(play.at);
  const undated = plays.length - dated.length;

  if (days === null && dated.length === 0) return { buckets: [], grain: "day", undated };
  const earliest = days === null ? Math.min(...dated) : daysBefore(now, days);

  const span = Math.round((startOfDay(now).getTime() - startOfDay(earliest).getTime()) / 86_400_000);
  const grain = grainFor(days, span);

  const buckets: Bucket[] = [];
  const index = new Map<number, Bucket>();
  for (let from = startOfGrain(grain, earliest); from <= now; from = advance(grain, from)) {
    const bucket: Bucket = { key: String(from), ...nameBucket(grain, from), plays: 0 };
    index.set(from, bucket);
    buckets.push(bucket);
  }

  for (const at of dated) {
    const bucket = index.get(startOfGrain(grain, at));
    if (bucket) bucket.plays += 1;
  }

  // Thin the axis from the newest column backwards, so today is always one of the labelled ones.
  const stride = Math.max(1, Math.ceil(buckets.length / AXIS_LABELS));
  const last = buckets.length - 1;
  for (const [position, bucket] of buckets.entries()) {
    if ((last - position) % stride !== 0) bucket.axis = "";
  }

  return { buckets, grain, undated };
}

/* ---------------------------------------------------------------------------
   Genre spread
   --------------------------------------------------------------------------- */

export interface GenreShare {
  id: number;
  name: string;
  plays: number;
  /** A few names, so a bar reading "Electro" can say whose. */
  artists: string[];
}

export interface GenreSpread {
  genres: GenreShare[];
  /** Plays credited to a genre, and plays whose artist nothing has looked up yet. */
  placed: number;
  unplaced: number;
}

/**
 * Plays grouped by the genre of the artist who was played.
 *
 * Timbre has no genre of its own. It learns one artist at a time, from Deezer, into the taste
 * book in localStorage, a few per visit — so a fresh browser can place almost nothing and a
 * well-used one places most of it. That is why `unplaced` comes back rather than being quietly
 * dropped: a spread reading "60% electronic" without saying "of the two-thirds we could name" is
 * a worse answer than no spread at all.
 */
export function genreSpread(
  artists: readonly ListeningStats["artists"][number][],
  genreOf: (name: string) => number | null,
  nameOf: (id: number) => string | undefined,
): GenreSpread {
  const genres = new Map<number, GenreShare>();
  let placed = 0;
  let unplaced = 0;

  for (const artist of artists) {
    const id = genreOf(artist.name);
    const name = id === null ? undefined : nameOf(id);
    if (id === null || name === undefined) {
      unplaced += artist.plays;
      continue;
    }

    placed += artist.plays;
    const share = genres.get(id) ?? { id, name, plays: 0, artists: [] };
    share.plays += artist.plays;
    if (share.artists.length < 3) share.artists.push(artist.name);
    genres.set(id, share);
  }

  return {
    genres: [...genres.values()].sort((a, b) => b.plays - a.plays || a.name.localeCompare(b.name)),
    placed,
    unplaced,
  };
}
