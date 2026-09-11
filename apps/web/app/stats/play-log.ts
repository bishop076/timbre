/**
 * Every play, and when it happened — what "Your listening" counts. The history cannot: it
 * keeps one row per song, a repeat moves that row to the front rather than adding one, and
 * it records no times, because it exists to draw a shelf. A count built from it would say
 * every song was played once.
 *
 * Local like the history, and for the same reason: there is no account to attach it to.
 * Written by `recordPlay` in `history-store.ts`, so both hear about the same plays.
 */

import { createLocalStore, useLocalStore } from "../local-store.ts";
import type { PlayedSong } from "../player/history-store";

export interface PlayLog {
  /** Newest first: which song, and when, in milliseconds since the epoch. */
  plays: [id: string, at: number][];
  /** Each song in `plays` once, as it last played. Kept apart from the plays so a song on
   * repeat costs a few bytes a play rather than its whole record. */
  songs: Record<string, PlayedSong>;
}

const LOG_KEY = "timbre:plays";

/**
 * Plays kept. Five hundred is weeks of listening for most and ten days for someone who
 * plays all day, at roughly 200KB when every one is a different song. The ceiling is the
 * localStorage budget this shares with playlists — a log that fills it would make saving a
 * playlist fail — so the window is the last N plays, and the page says so.
 */
export const PLAY_LOG_LIMIT = 500;

/** Referentially stable, and what hydration renders against. */
export const EMPTY_LOG: PlayLog = { plays: [], songs: {} };

/** A song the log holds, or undefined. `hasOwn`, since an id is a key in a plain object and
 * `songs["constructor"]` is otherwise always something. */
export function loggedSong(log: PlayLog, id: string): PlayedSong | undefined {
  return Object.hasOwn(log.songs, id) ? log.songs[id] : undefined;
}

/** The log with one more play at the front. Songs no play refers to any more are dropped
 * with the play that last named them. */
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
    // The newest record of a song wins — its artwork or source may have changed since.
    const record = id === song.id ? song : loggedSong(log, id);
    if (record) songs[id] = record;
  }
  return { plays, songs };
}

/** Whether a stored song is one this code can use. Only what the stats read is checked. */
function isSong(value: unknown): value is PlayedSong {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<PlayedSong>;
  return typeof entry.id === "string" && typeof entry.title === "string";
}

/**
 * Stored data, checked. It outlives the code that wrote it, and another tab or an older
 * version may have written it, so anything malformed drops itself — a play whose song is
 * missing, a time that is not a number — rather than throwing on render.
 */
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

  // Only the songs something still refers to.
  const used: Record<string, PlayedSong> = {};
  for (const [id] of kept) used[id] = known[id]!;
  return { plays: kept, songs: used };
}

function read(): PlayLog {
  try {
    const raw = window.localStorage.getItem(LOG_KEY);
    return raw ? parsePlayLog(JSON.parse(raw)) : EMPTY_LOG;
  } catch {
    // Private browsing, blocked storage and malformed JSON all throw rather than return null.
    return EMPTY_LOG;
  }
}

// A failed write is swallowed by `save`: not being able to count a play is no reason to fail
// the playback that triggered it.
const store = createLocalStore<PlayLog>({
  read,
  initial: EMPTY_LOG,
  write: (next) => window.localStorage.setItem(LOG_KEY, JSON.stringify(next)),
  keys: [LOG_KEY],
});

/** Subscribes a component to the log. Client-only, like the store. */
export function usePlayLog(): PlayLog {
  return useLocalStore(store);
}

/** Counts one play of `song`, now. */
export function logPlay(song: PlayedSong, at = Date.now()): void {
  store.save(appendPlay(store.getSnapshot(), song, at));
}
