/**
 * What you have listened to, on this device and nowhere else — Timbre has no accounts, so
 * a server-side history has nothing to attach to. It powers "Recently played", "Because
 * you played X" (the only way to seed the recommender on a cold load), and not suggesting
 * what you just heard. Deliberately not a taste model — see docs/RECOMMENDATIONS.md.
 *
 * Mirrors `volume-store.ts`: localStorage is an external store, and reading it into React
 * state after mount is a cascading render by another name.
 */

import { createLocalStore, useLocalStore } from "../local-store.ts";

export interface PlayedSong {
  id: string;
  title: string;
  artists: string[];
  artworkUrl: string | null;
  /** The upload that actually played, which is what seeds a radio. */
  videoId: string | null;
}

const HISTORY_KEY = "timbre:history";

/** Fifty is a few weeks of casual listening at roughly 20KB against a 5MB budget, and the
 * cap stops the store growing without bound. */
const LIMIT = 50;

/** Referentially stable, and what hydration renders against. */
const EMPTY: PlayedSong[] = [];

function isPlayed(value: unknown): value is PlayedSong {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<PlayedSong>;
  return typeof entry.id === "string" && typeof entry.title === "string";
}

function read(): PlayedSong[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    // Stored data outlives the code that wrote it, so a bad row drops itself rather than
    // throwing on render.
    const entries = parsed.filter(isPlayed);
    return entries.length > 0 ? entries : EMPTY;
  } catch {
    // Private browsing, blocked storage and malformed JSON all throw rather than return null.
    return EMPTY;
  }
}

// A failed write is swallowed: not being able to remember a play is no reason to fail the
// playback that triggered it.
const store = createLocalStore<PlayedSong[]>({
  read,
  initial: EMPTY,
  write: (next) => window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next)),
  keys: [HISTORY_KEY],
});

export const subscribeHistory = store.subscribe;
export const getHistorySnapshot = store.getSnapshot;
export const getHistoryServerSnapshot = store.getServerSnapshot;

/** Subscribes a component to the history. Client-only, like the store. */
export function useHistory(): PlayedSong[] {
  return useLocalStore(store);
}

/** Records a play, newest first, one entry per song. A repeat moves to the front rather
 * than adding a row, or a track on loop fills the whole shelf. */
export function recordPlay(song: PlayedSong): void {
  const current = getHistorySnapshot();
  if (current[0]?.id === song.id) return;

  store.save([song, ...current.filter((entry) => entry.id !== song.id)].slice(0, LIMIT));
}
