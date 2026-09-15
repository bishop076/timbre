import { createJsonStore, useLocalStore } from "../local-store.ts";
import { logPlay, playedSong } from "../stats/play-log.ts";
import type { PlayContext } from "../types";

export interface PlayedSong {
  id: string;
  title: string;
  artists: string[];
  artworkUrl: string | null;
  videoId: string | null;
  source?: string;
  sourceId?: string;
  url?: string | null;
  from?: PlayContext;
}

const LIMIT = 50;
const EMPTY: PlayedSong[] = [];

/**
 * Reads the stored list under the same two rules the write path applies: at most `LIMIT`
 * entries, and one entry per song.
 *
 * `recordPlay` slices and de-duplicates on the way out, and nothing enforced either on the way
 * back in — so whatever was found under the key was returned whole. A value written by an older
 * build with a larger limit, merged by a second tab, or edited by hand came back at its full
 * length with repeats intact, and `playsFrom` turns every history entry the log has not seen
 * into a separate undated play: the same song counted once per copy, straight into "Top songs".
 * A bound only the writer honours is not a bound.
 */
const store = createJsonStore("timbre:history", EMPTY, (stored) => {
  if (!Array.isArray(stored)) return EMPTY;

  const entries: PlayedSong[] = [];
  const seen = new Set<string>();
  for (const value of stored) {
    if (entries.length >= LIMIT) break;
    const entry = playedSong(value);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
  }
  return entries.length > 0 ? entries : EMPTY;
});

export const getHistorySnapshot = store.getSnapshot;

/**
 * Appends a backup's recently-played list to this browser's, skipping songs already in it,
 * and returns how many were new. History carries no timestamps, so imported entries land
 * behind what this browser played itself rather than being interleaved by guesswork.
 */
export function importHistory(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  const incoming = value.map(playedSong).filter((entry): entry is PlayedSong => entry !== null);
  if (incoming.length === 0) return 0;

  const current = getHistorySnapshot();
  const seen = new Set(current.map((entry) => entry.id));
  const merged = [...current];
  for (const entry of incoming) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    merged.push(entry);
  }

  const next = merged.slice(0, LIMIT);
  if (next.length === current.length) return 0;
  store.save(next);
  return next.length - current.length;
}

export function useHistory(): PlayedSong[] {
  return useLocalStore(store);
}

/**
 * One play, recorded once — in the log the stats read and in the recently-played list, or in
 * neither.
 *
 * The guard below is this module's definition of "the same play told to us twice": the song
 * already at the front, from the same source. The log was written *above* it, so in exactly the
 * case history judged a repeat the counter still moved — one listen, two plays in "Top songs",
 * and two credits to the artist. The caller in `player-context` has its own `recorded` ref, but a
 * bound that depends on every caller holding one is not a bound either.
 */
export function recordPlay(song: PlayedSong): void {
  const current = getHistorySnapshot();
  const front = current[0];
  if (front?.id === song.id && front.source === song.source && front.sourceId === song.sourceId) {
    return;
  }

  logPlay(song);
  store.save([song, ...current.filter((entry) => entry.id !== song.id)].slice(0, LIMIT));
}
