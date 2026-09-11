"use client";

import { createLocalStore, useLocalStore } from "../local-store.ts";
import type { LyricsProvider } from "./lyrics-source.ts";

export interface LyricsPref {
  id?: number;
  offset?: number;
  provider?: LyricsProvider;
}

const KEY = "timbre:lyrics-prefs";

const MAX_ENTRIES = 300;

const EMPTY: Record<string, LyricsPref> = {};

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

const store = createLocalStore<Record<string, LyricsPref>>({
  read,
  initial: EMPTY,
  write: (map) => {
    const keys = Object.keys(map);
    if (keys.length > MAX_ENTRIES) {
      for (const key of keys.slice(0, keys.length - MAX_ENTRIES)) delete map[key];
    }
    window.localStorage.setItem(KEY, JSON.stringify(map));
  },
});

export function useLyricsPref(key: string): LyricsPref {
  const map = useLocalStore(store);
  return map[key] ?? EMPTY_PREF;
}

const EMPTY_PREF: LyricsPref = {};

export function setLyricsId(key: string, id: number | undefined): void {
  const all = store.getSnapshot();
  const current = all[key] ?? {};
  store.save({ ...all, [key]: { ...current, id, offset: undefined, provider: undefined } });
}

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

export function setLyricsOffset(key: string, offset: number): void {
  const all = store.getSnapshot();
  const current = all[key] ?? {};
  const rounded = Math.round(offset * 10) / 10;
  store.save({
    ...all,
    [key]: { ...current, offset: rounded === 0 ? undefined : rounded },
  });
}

export function clearLyricsPref(key: string): void {
  const next = { ...store.getSnapshot() };
  delete next[key];
  store.save(next);
}
