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

export const getPlayLog = store.getSnapshot;

export function usePlayLog(): PlayLog {
  return useLocalStore(store);
}

/**
 * Merges a backup's play log into this browser's, newest first, and returns how many plays
 * were new. A play is identified by its song and its timestamp, so importing the same file
 * twice adds nothing the second time.
 */
export function importPlayLog(value: unknown, limit = PLAY_LOG_LIMIT): number {
  const incoming = parsePlayLog(value, limit);
  if (incoming.plays.length === 0) return 0;

  const current = store.getSnapshot();
  const key = ([id, at]: PlayLog["plays"][number]) => `${id}@${at}`;
  const seen = new Set(current.plays.map(key));

  let added = 0;
  const plays = [...current.plays];
  for (const play of incoming.plays) {
    if (seen.has(key(play))) continue;
    seen.add(key(play));
    plays.push(play);
    added += 1;
  }
  if (added === 0) return 0;

  plays.sort((a, b) => b[1] - a[1]);
  const kept = plays.slice(0, limit);
  const songs: Record<string, PlayedSong> = {};
  for (const [id] of kept) {
    const record = loggedSong(current, id) ?? loggedSong(incoming, id);
    if (record) songs[id] = record;
  }
  store.save({ plays: kept, songs });
  return added;
}

export function logPlay(song: PlayedSong, at = Date.now()): void {
  store.save(appendPlay(store.getSnapshot(), song, at));
}
