import { createLocalStore, useLocalStore } from "../local-store.ts";
import type { PlayedSong } from "../player/history-store";

export interface PlayLog {
  plays: [id: string, at: number][];
  songs: Record<string, PlayedSong>;
}

const LOG_KEY = "timbre:plays";

export const PLAY_LOG_LIMIT = 500;

export const EMPTY_LOG: PlayLog = { plays: [], songs: {} };

export function loggedSong(log: PlayLog, id: string): PlayedSong | undefined {
  return Object.hasOwn(log.songs, id) ? log.songs[id] : undefined;
}

export function appendPlay(
  log: PlayLog,
  song: PlayedSong,
  at: number,
  limit = PLAY_LOG_LIMIT,
): PlayLog {
  const newest: PlayLog["plays"][number] = [song.id, at];
  const plays = [newest, ...log.plays].slice(0, limit);
  const songs: Record<string, PlayedSong> = {};
  for (const [id] of plays) {
    if (Object.hasOwn(songs, id)) continue;
    const record = id === song.id ? song : loggedSong(log, id);
    if (record) songs[id] = record;
  }
  return { plays, songs };
}

function isSong(value: unknown): value is PlayedSong {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<PlayedSong>;
  return typeof entry.id === "string" && typeof entry.title === "string";
}

export function parsePlayLog(raw: unknown, limit = PLAY_LOG_LIMIT): PlayLog {
  if (typeof raw !== "object" || raw === null) return EMPTY_LOG;
  const { plays, songs } = raw as { plays?: unknown; songs?: unknown };
  if (!Array.isArray(plays) || typeof songs !== "object" || songs === null) return EMPTY_LOG;

  const known: Record<string, PlayedSong> = {};
  for (const [id, song] of Object.entries(songs)) {
    if (isSong(song) && song.id === id) known[id] = song;
  }

  const kept: PlayLog["plays"] = [];
  for (const play of plays) {
    if (kept.length >= limit) break;
    if (!Array.isArray(play)) continue;
    const [id, at] = play as unknown[];
    if (typeof id !== "string" || typeof at !== "number" || !Number.isFinite(at)) continue;
    if (!Object.hasOwn(known, id)) continue;
    kept.push([id, at]);
  }
  if (kept.length === 0) return EMPTY_LOG;

  const used: Record<string, PlayedSong> = {};
  for (const [id] of kept) used[id] = known[id]!;
  return { plays: kept, songs: used };
}

function read(): PlayLog {
  try {
    const raw = window.localStorage.getItem(LOG_KEY);
    return raw ? parsePlayLog(JSON.parse(raw)) : EMPTY_LOG;
  } catch {
    return EMPTY_LOG;
  }
}

const store = createLocalStore<PlayLog>({
  read,
  initial: EMPTY_LOG,
  write: (next) => window.localStorage.setItem(LOG_KEY, JSON.stringify(next)),
  keys: [LOG_KEY],
});

export function usePlayLog(): PlayLog {
  return useLocalStore(store);
}

export function logPlay(song: PlayedSong, at = Date.now()): void {
  store.save(appendPlay(store.getSnapshot(), song, at));
}
