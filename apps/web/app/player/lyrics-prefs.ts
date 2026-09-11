"use client";

// Per-song lyrics corrections, remembered in this browser — LRCLIB has a dozen community
// entries per song and Timbre's automatic pick is sometimes wrong, so a correction has to
// stick across plays. `id` names a record; `offset` shifts timestamps, positive for late;
// `provider` is where the words come from.

import { createLocalStore, useLocalStore } from "../local-store.ts";
import type { LyricsProvider } from "./lyrics-source.ts";

export interface LyricsPref {
  id?: number;
  offset?: number;
  /** Absent means LRCLIB, so every preference stored before YouTube Music existed still
   * reads as what it was. Only a choice of YouTube Music is ever written. */
  provider?: LyricsProvider;
}

const KEY = "timbre:lyrics-prefs";

/** Bounded so one browser cannot accumulate a preference for every song ever. */
const MAX_ENTRIES = 300;

const EMPTY: Record<string, LyricsPref> = {};

/** Identity of the recording, not the queue's object. */
export function songKey(title: string, artist: string): string {
  return `${title}::${artist}`.toLowerCase();
}

function read(): Record<string, LyricsPref> {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, LyricsPref>) : {};
  } catch {
    return {};
  }
}

// No `keys`, so no cross-tab handling: a correction belongs to the tab that is playing, and
// following another tab's would move the lyrics under the listener.
const store = createLocalStore<Record<string, LyricsPref>>({
  read,
  initial: EMPTY,
  write: (map) => {
    // Evicted on the way out, oldest key first, so the map that is published is the map that
    // was stored.
    const keys = Object.keys(map);
    if (keys.length > MAX_ENTRIES) {
      for (const key of keys.slice(0, keys.length - MAX_ENTRIES)) delete map[key];
    }
    window.localStorage.setItem(KEY, JSON.stringify(map));
  },
});

/** The stored correction for one song, or an empty one. */
export function useLyricsPref(key: string): LyricsPref {
  const map = useLocalStore(store);
  return map[key] ?? EMPTY_PREF;
}

/** Shared, so an unset song returns a stable object rather than a new one. */
const EMPTY_PREF: LyricsPref = {};

/** Pins a song to one LRCLIB record — which also means reading it from LRCLIB. */
export function setLyricsId(key: string, id: number | undefined): void {
  const all = store.getSnapshot();
  const current = all[key] ?? {};
  // A new record has its own timing, so an old nudge is dropped, not carried over.
  store.save({ ...all, [key]: { ...current, id, offset: undefined, provider: undefined } });
}

/**
 * Chooses where a song's lyrics come from. The nudge is dropped, for the same reason as a
 * new record's: it was measured against the other provider's timestamps. The LRCLIB pick is
 * kept, so a look at YouTube Music and back lands on the record chosen before.
 */
export function setLyricsProvider(key: string, provider: LyricsProvider): void {
  const all = store.getSnapshot();
  const current = all[key] ?? {};
  store.save({
    ...all,
    [key]: {
      ...current,
      provider: provider === "ytmusic" ? provider : undefined,
      offset: undefined,
    },
  });
}

/** Shifts a song's timings, to a tenth of a second. */
export function setLyricsOffset(key: string, offset: number): void {
  const all = store.getSnapshot();
  const current = all[key] ?? {};
  const rounded = Math.round(offset * 10) / 10;
  store.save({
    ...all,
    [key]: { ...current, offset: rounded === 0 ? undefined : rounded },
  });
}

/** Forgets every correction for a song, the choice of provider included. */
export function clearLyricsPref(key: string): void {
  const next = { ...store.getSnapshot() };
  delete next[key];
  store.save(next);
}
