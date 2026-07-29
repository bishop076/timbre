/**
 * What you have listened to, stored on this device and nowhere else.
 *
 * Timbre has no accounts — there is no sign-in page and no user row — so a
 * server-side play history is not merely unbuilt, it has nothing to attach to.
 * localStorage sidesteps identity entirely, and the privacy posture that falls
 * out is genuinely better than the alternative: **this never leaves the
 * browser.** Nothing is uploaded, and clearing site data is a complete delete.
 *
 * It powers three things, all recall rather than modelling:
 *
 *   - "Recently played" on the home page
 *   - "Because you played X", seeding the recommender with a real seed on a
 *     cold load, which is otherwise impossible — nothing is playing yet
 *   - not suggesting a song you just heard
 *
 * Deliberately **not** a taste model. With one listener, item-item
 * co-occurrence just re-derives the queues you already built and calls it
 * discovery; the services' own models are fit on millions of people and arrive
 * free in one request. See docs/RECOMMENDATIONS.md.
 *
 * Mirrors `volume-store.ts` exactly, including why: localStorage is an external
 * store, and reading it into React state after mount is a cascading render by
 * another name.
 */

import { useSyncExternalStore } from "react";

export interface PlayedSong {
  id: string;
  title: string;
  artists: string[];
  artworkUrl: string | null;
  /** The upload that actually played, which is what seeds a radio. */
  videoId: string | null;
  playedAt: number;
}

const HISTORY_KEY = "timbre:history";

/**
 * How much is kept.
 *
 * Fifty entries is a few weeks of casual listening at roughly 20KB — nothing
 * against a 5MB budget — and far more than any shelf shows. The cap exists so
 * the store cannot grow without bound on a machine nobody clears.
 */
const LIMIT = 50;

/** Referentially stable, and what hydration renders against. */
const EMPTY: PlayedSong[] = [];

let snapshot: PlayedSong[] = EMPTY;
let loaded = false;

const listeners = new Set<() => void>();

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
    // Stored data outlives the code that wrote it, so every entry is checked
    // rather than trusted. One bad row drops itself instead of throwing on
    // render.
    const entries = parsed.filter(isPlayed);
    return entries.length > 0 ? entries : EMPTY;
  } catch {
    // Private browsing and blocked storage both throw rather than returning
    // null, and so does malformed JSON.
    return EMPTY;
  }
}

function publish(next: PlayedSong[]): void {
  snapshot = next;
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // Not being able to remember it is no reason to fail the playback that
    // triggered it.
  }
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent): void {
  if (event.key !== HISTORY_KEY) return;
  snapshot = read();
  for (const listener of listeners) listener();
}

export function subscribeHistory(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function getHistorySnapshot(): PlayedSong[] {
  if (!loaded) {
    loaded = true;
    snapshot = read();
  }
  return snapshot;
}

export function getHistoryServerSnapshot(): PlayedSong[] {
  return EMPTY;
}

/**
 * Records a play, newest first, one entry per song.
 *
 * Re-playing a song moves it to the front rather than adding a second row —
 * "recently played" is a set of songs in time order, not a log of events, and
 * a repeat on loop would otherwise fill the whole shelf with one track.
 */
/** Subscribes a component to the history. Client-only, like the store. */
export function useHistory(): PlayedSong[] {
  return useSyncExternalStore(subscribeHistory, getHistorySnapshot, getHistoryServerSnapshot);
}

export function recordPlay(song: PlayedSong): void {
  const current = getHistorySnapshot();
  if (current[0]?.id === song.id) return;

  publish([song, ...current.filter((entry) => entry.id !== song.id)].slice(0, LIMIT));
}
