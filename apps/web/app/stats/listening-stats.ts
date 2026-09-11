import { artistKey } from "../../lib/genre-tally.ts";
import type { PlayedSong } from "../player/history-store";
import { loggedSong, PLAY_LOG_LIMIT, type PlayLog } from "./play-log.ts";

/*
 * "Your listening": what this browser played, counted. Pure, so it is tested rather than
 * eyeballed — both inputs are local storage and outlive the code that wrote them. Nothing
 * here is "all time": the play log is capped and the history before it kept no counts, and
 * `ListeningStats` carries enough for the page to say which window it is showing.
 */

/** One play. `at` is null for a play that predates the log — see `playsFrom`. */
export interface Play {
  song: PlayedSong;
  at: number | null;
}

/**
 * Every play the page counts, newest first: the log, then — only while the log is short of
 * its cap — each history song the log has never seen, once and undated.
 *
 * Those are the songs played before the log existed. The history knew they were played but
 * not how often or when, so once is the honest count. A full log is the last N plays exactly,
 * and anything the history adds would be older than all of them, so it adds nothing then.
 */
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

export interface ArtistStat {
  /** The grouping key — case, accents and punctuation folded, as the taste count does. */
  key: string;
  /** Spelled as it was most recently played. */
  name: string;
  plays: number;
  /** Different songs of theirs among those plays. */
  songs: number;
}

export interface SongStat {
  song: PlayedSong;
  plays: number;
  /** The most recent dated play, or null when every play of it predates the log. */
  lastAt: number | null;
}

export interface ListeningStats {
  total: number;
  /** Plays with a time. Only these reach the weekday count and the dates. */
  dated: number;
  /** Songs carried over from the history, counted once each. */
  undated: number;
  /** The earliest and latest dated plays. */
  first: number | null;
  last: number | null;
  /** Calendar days from the first dated play to the last, both included. Zero without one. */
  days: number;
  /** Every artist, most played first. */
  artists: ArtistStat[];
  /** Every song, most played first. */
  songs: SongStat[];
  /** Dated plays by local day of the week, Monday first. */
  weekdays: number[];
}

/** Monday first, matching `ListeningStats.weekdays`. */
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** A song's artists as strings, whatever storage held. */
function artistsOf(song: PlayedSong): string[] {
  const names: unknown = song.artists;
  if (!Array.isArray(names)) return [];
  return names.filter((name): name is string => typeof name === "string" && name.trim() !== "");
}

/** The grouping key. `artistKey` folds a name made only of punctuation — "!!!" — to nothing,
 * which would merge every such band into one, so that falls back to the lowercased name. */
function keyOf(name: string): string {
  return artistKey(name) || name.trim().toLowerCase();
}

/** Local midnight, so a span counts calendar days rather than 24-hour periods. */
function dayOf(at: number): number {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Counts `plays`, which must be newest first — ties are broken by who was played last. */
export function listeningStats(plays: readonly Play[]): ListeningStats {
  const artists = new Map<string, { name: string; plays: number; songs: Set<string>; order: number }>();
  const songs = new Map<string, SongStat & { order: number }>();
  const weekdays = [0, 0, 0, 0, 0, 0, 0];
  let dated = 0;
  let first: number | null = null;
  let last: number | null = null;

  plays.forEach((play, order) => {
    const { song, at } = play;

    const counted = songs.get(song.id);
    if (counted) {
      counted.plays += 1;
      if (at !== null && (counted.lastAt === null || at > counted.lastAt)) counted.lastAt = at;
    } else {
      songs.set(song.id, { song, plays: 1, lastAt: at, order });
    }

    // Every credited artist gets the play — a duet is a play of both. Once each, though: a
    // name listed twice on one song is still one play.
    const credited = new Set<string>();
    for (const name of artistsOf(song)) {
      const key = keyOf(name);
      if (credited.has(key)) continue;
      credited.add(key);

      const artist = artists.get(key);
      if (artist) {
        artist.plays += 1;
        artist.songs.add(song.id);
      } else {
        artists.set(key, { name: name.trim(), plays: 1, songs: new Set([song.id]), order });
      }
    }

    if (at !== null) {
      dated += 1;
      if (first === null || at < first) first = at;
      if (last === null || at > last) last = at;
      // `getDay` is Sunday-first; the week here starts on Monday.
      weekdays[(new Date(at).getDay() + 6) % 7] += 1;
    }
  });

  return {
    total: plays.length,
    dated,
    undated: plays.length - dated,
    first,
    last,
    days:
      first === null || last === null
        ? 0
        : // Rounded: a day with a clock change in it is 23 or 25 hours long.
          Math.round((dayOf(last) - dayOf(first)) / 86_400_000) + 1,
    artists: [...artists]
      .sort(
        ([, a], [, b]) => b.plays - a.plays || b.songs.size - a.songs.size || a.order - b.order,
      )
      .map(([key, artist]) => ({
        key,
        name: artist.name,
        plays: artist.plays,
        songs: artist.songs.size,
      })),
    songs: [...songs.values()]
      .sort((a, b) => b.plays - a.plays || a.order - b.order)
      .map(({ song, plays: count, lastAt }) => ({ song, plays: count, lastAt })),
    weekdays,
  };
}
