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
  days: number;
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
  let dated = 0;
  let first: number | null = null;
  let last: number | null = null;

  for (const { song, at } of plays) {
    const counted = songs.get(song.id) ?? { song, plays: 0 };
    counted.plays += 1;
    songs.set(song.id, counted);

    const credited = new Set<string>();
    for (const name of artistsOf(song)) {
      const key = artistKey(name) || name.toLowerCase();
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
    artists: [...artists]
      .sort(([, a], [, b]) => b.plays - a.plays || b.songs.size - a.songs.size)
      .map(([key, artist]) => ({ key, ...artist, songs: artist.songs.size })),
    songs: [...songs.values()].sort((a, b) => b.plays - a.plays),
    weekdays,
  };
}
