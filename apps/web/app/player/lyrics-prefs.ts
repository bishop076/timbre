"use client";

// Per-song lyrics corrections, remembered in this browser — LRCLIB has a dozen community
// entries per song and Timbre's automatic pick is sometimes wrong, so a correction has to
// stick across plays. `id` names a record; `offset` shifts timestamps, positive for late.

import { useSyncExternalStore } from "react";

export interface LyricsPref {
  id?: number;
  offset?: number;
}

const KEY = "timbre:lyrics-prefs";

/** Bounded so one browser cannot accumulate a preference for every song ever. */
const MAX_ENTRIES = 300;

const EMPTY: Record<string, LyricsPref> = {};

let all: Record<string, LyricsPref> = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

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

function persist(): void {
  try {
    const keys = Object.keys(all);
    if (keys.length > MAX_ENTRIES) {
      for (const key of keys.slice(0, keys.length - MAX_ENTRIES)) delete all[key];
    }
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // The correction still applies for this session.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Record<string, LyricsPref> {
  if (!loaded) {
    loaded = true;
    all = read();
  }
  return all;
}

function getServerSnapshot(): Record<string, LyricsPref> {
  return EMPTY;
}

/** The stored correction for one song, or an empty one. */
export function useLyricsPref(key: string): LyricsPref {
  const map = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return map[key] ?? EMPTY_PREF;
}

/** Shared, so an unset song returns a stable object rather than a new one. */
const EMPTY_PREF: LyricsPref = {};

/** Pins a song to one LRCLIB record. */
export function setLyricsId(key: string, id: number | undefined): void {
  const current = getSnapshot()[key] ?? {};
  // A new record has its own timing, so an old nudge is dropped, not carried over.
  all = { ...all, [key]: { ...current, id, offset: undefined } };
  persist();
}

/** Shifts a song's timings, to a tenth of a second. */
export function setLyricsOffset(key: string, offset: number): void {
  const current = getSnapshot()[key] ?? {};
  const rounded = Math.round(offset * 10) / 10;
  all = {
    ...all,
    [key]: { ...current, offset: rounded === 0 ? undefined : rounded },
  };
  persist();
}

/** Forgets both corrections for a song. */
export function clearLyricsPref(key: string): void {
  const next = { ...getSnapshot() };
  delete next[key];
  all = next;
  persist();
}
