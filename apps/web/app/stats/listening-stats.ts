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

export interface ArtistStat {
  key: string;
  name: string;
  plays: number;
  songs: number;
}

export interface SongStat {
  song: PlayedSong;
  plays: number;
  lastAt: number | null;
}

export interface ListeningStats {
  total: number;
  dated: number;
  undated: number;
  first: number | null;
  last: number | null;
  days: number;
  artists: ArtistStat[];
  songs: SongStat[];
  weekdays: number[];
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function artistsOf(song: PlayedSong): string[] {
  const names: unknown = song.artists;
  if (!Array.isArray(names)) return [];
  return names.filter((name): name is string => typeof name === "string" && name.trim() !== "");
}

function keyOf(name: string): string {
  return artistKey(name) || name.trim().toLowerCase();
}

function dayOf(at: number): number {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

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
        : Math.round((dayOf(last) - dayOf(first)) / 86_400_000) + 1,
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
