"use client";

/**
 * Per-song lyrics corrections, remembered in this browser.
 *
 * LRCLIB is community-contributed, and one song routinely has a dozen entries —
 * different albums, different transcriptions, some timed against a version with
 * a longer intro. Timbre picks one automatically and is sometimes wrong, so two
 * corrections are offered and both have to **stick**: fixing the same song on
 * every play would be worse than not offering the fix at all.
 *
 * - `id` — a specific LRCLIB record, chosen when the automatic match was wrong.
 * - `offset` — seconds to shift every timestamp. Positive means the words are
 *   arriving late and should be pulled earlier.
 *
 * Kept beside the other browser state rather than on a server, for the reason
 * everything else here is: Timbre stores nothing about anyone.
 */

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
    // Corrupt or blocked. A forgotten correction is a small loss.
    return {};
  }
}

function persist(): void {
  try {
    const keys = Object.keys(all);
    if (keys.length > MAX_ENTRIES) {
      // Oldest-inserted first, which for a plain object is insertion order.
      for (const key of keys.slice(0, keys.length - MAX_ENTRIES)) delete all[key];
    }
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Out of quota. The correction still applies for this session.
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

export function useLyricsPref(key: string): LyricsPref {
  const map = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return map[key] ?? EMPTY_PREF;
}

/** Shared so an unset song returns a stable object rather than a new one. */
const EMPTY_PREF: LyricsPref = {};

export function setLyricsId(key: string, id: number | undefined): void {
  const current = getSnapshot()[key] ?? {};
  // A new record has its own timing, so a nudge tuned to the old one is wrong
  // and is dropped rather than silently carried over.
  all = { ...all, [key]: { ...current, id, offset: undefined } };
  persist();
}

export function setLyricsOffset(key: string, offset: number): void {
  const current = getSnapshot()[key] ?? {};
  const rounded = Math.round(offset * 10) / 10;
  all = {
    ...all,
    [key]: { ...current, offset: rounded === 0 ? undefined : rounded },
  };
  persist();
}

export function clearLyricsPref(key: string): void {
  const next = { ...getSnapshot() };
  delete next[key];
  all = next;
  persist();
}
