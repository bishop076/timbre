import { createJsonStore, useLocalStore } from "../local-store.ts";
import type { PlayedSong } from "../player/history-store";
import { usableArtwork } from "../song-shape.ts";

export interface PlayLog {
  plays: [id: string, at: number][];
  songs: Record<string, PlayedSong>;
}

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

export function parsePlayLog(raw: unknown, limit = PLAY_LOG_LIMIT): PlayLog {
  if (typeof raw !== "object" || raw === null) return EMPTY_LOG;
  const { plays, songs } = raw as { plays?: unknown; songs?: unknown };
  if (!Array.isArray(plays) || typeof songs !== "object" || songs === null) return EMPTY_LOG;

  // Same rule as the history store: a stored cover is kept only if `/api/art` would serve
  // it, so an old entry naming a third-party host stops being drawn from that host.
  const known: Record<string, PlayedSong> = {};
  for (const [id, song] of Object.entries(songs)) {
    if (song?.id !== id || typeof song.title !== "string") continue;
    known[id] = { ...song, artworkUrl: usableArtwork(song.artworkUrl) };
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

  return { plays: kept, songs: Object.fromEntries(kept.map(([id]) => [id, known[id]!])) };
}

const store = createJsonStore("timbre:plays", EMPTY_LOG, parsePlayLog);

export function usePlayLog(): PlayLog {
  return useLocalStore(store);
}

export function logPlay(song: PlayedSong, at = Date.now()): void {
  store.save(appendPlay(store.getSnapshot(), song, at));
}
