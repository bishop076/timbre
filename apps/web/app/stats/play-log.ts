import { createJsonStore, useLocalStore } from "../local-store.ts";
import { log } from "../logs.ts";
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

/**
 * The shape rule for a stored song, shared with the history store.
 *
 * The two stores hold the same records and disagreed about what one looks like: history insisted
 * `artists` be an array of strings, the log asked only for a matching id and a title. So a log
 * entry could carry `artists: "Drake"`, or none at all, and `/stats` renders those through
 * `songFromHistory` into `<ArtistLink>` — where `artists.join(", ")` throws and takes the page
 * down. One rule, applied by both, or the weaker one decides.
 *
 * It lives here rather than next to `PlayedSong` because `history-store.ts` already imports this
 * module for `logPlay`; a value import the other way would be a cycle.
 */
export function playedSong(value: unknown): PlayedSong | null {
  if (typeof value !== "object" || value === null) return null;
  const entry = value as Partial<PlayedSong>;
  if (typeof entry.id !== "string" || !entry.id || typeof entry.title !== "string") return null;
  if (!Array.isArray(entry.artists)) return null;
  if (!entry.artists.every((artist) => typeof artist === "string")) return null;
  if (entry.artworkUrl != null && typeof entry.artworkUrl !== "string") return null;

  // A playlist and a liked song are read back through `usableSong`, which keeps a cover only on a
  // host `/api/art` serves. Hold a played song to the same rule, so a cover this browser stored
  // before that rule existed stops being fetched from a third-party host on every visit.
  const song = entry as PlayedSong;
  const artworkUrl = usableArtwork(song.artworkUrl);
  return artworkUrl === song.artworkUrl ? song : { ...song, artworkUrl };
}

/**
 * The largest value a `Date` can hold. `Number.isFinite` was the whole guard on a play's time,
 * and it lets `1e20` through — finite, but `new Date(1e20)` is an Invalid Date. One of those in
 * the log made `stats.days` NaN, printed "Invalid Date" in the range line, and ran
 * `weekdays[NaN] += 1`, which puts a `NaN` key on the tally array. localStorage is editable by
 * hand and an imported backup is an arbitrary file, so this is reachable without a bug upstream.
 */
const MAX_TIME = 8.64e15;

export function playedAt(value: unknown): number | null {
  const at = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(at) && at > 0 && at <= MAX_TIME ? at : null;
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

  const known: Record<string, PlayedSong> = {};
  for (const [id, song] of Object.entries(songs)) {
    const record = playedSong(song);
    if (record?.id !== id) continue;
    known[id] = record;
  }

  const kept: PlayLog["plays"] = [];
  for (const play of plays) {
    if (kept.length >= limit) break;
    if (!Array.isArray(play)) continue;
    const [id, when] = play as unknown[];
    const at = playedAt(when);
    if (typeof id !== "string" || at === null) continue;
    if (!Object.hasOwn(known, id)) continue;
    kept.push([id, at]);
  }
  if (kept.length === 0) return EMPTY_LOG;

  return { plays: kept, songs: Object.fromEntries(kept.map(([id]) => [id, known[id]!])) };
}

const store = createJsonStore("timbre:plays", EMPTY_LOG, parsePlayLog);

/** The same log with only its newest `limit` plays, and only the songs those name. */
function shorter(full: PlayLog, limit: number): PlayLog {
  if (full.plays.length <= limit) return full;
  const plays = full.plays.slice(0, limit);
  const songs: Record<string, PlayedSong> = {};
  for (const [id] of plays) {
    const record = loggedSong(full, id);
    if (record) songs[id] = record;
  }
  return { plays, songs };
}

/**
 * Stores as much of the log as this browser will take, and says whether any of it landed.
 *
 * `QuotaExceededError` is not an exotic condition for this key. It holds up to 500 plays with a
 * full song record behind each, it only ever grows, and it shares a 5MB budget with every
 * playlist, every liked song and two data-URL thumbnails. A failed write used to be swallowed
 * whole: the play stayed in this tab's memory, never reached storage, and every play after it
 * failed the same way — so /stats quietly froze at whatever it held when the browser filled up,
 * and a reload threw away everything since. Losing the oldest plays to keep counting the newest
 * is the trade this store already makes at `PLAY_LOG_LIMIT`; making it under pressure too is the
 * same rule, and there is no server copy to fall back on.
 */
function keep(next: PlayLog): boolean {
  for (let limit = next.plays.length; limit >= 1; limit = Math.floor(limit / 4)) {
    if (store.save(shorter(next, limit))) return true;
  }
  return false;
}

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
  // An import that was not stored did not happen: the caller prints the number this returns.
  if (!keep({ plays: kept, songs })) {
    store.publish(current);
    return 0;
  }
  return added;
}

export function logPlay(song: PlayedSong, at = Date.now()): void {
  const current = store.getSnapshot();
  if (keep(appendPlay(current, song, at))) return;

  // Nothing at all fits, so something else filled the browser. Put the snapshot back in step
  // with what is actually stored, rather than leaving this tab counting plays that no reload
  // will ever see again.
  store.publish(current);
  log(
    "warn",
    "This browser is out of storage, so plays are no longer being counted. Remove a playlist or a profile picture.",
  );
}
