"use client";

import { createJsonStore, useLocalStore } from "../local-store.ts";
import type { LyricsProvider } from "./lyrics-source.ts";

interface LyricsPref {
  id?: number;
  offset?: number;
  provider?: LyricsProvider;
}

const MAX_ENTRIES = 300;
const EMPTY: Record<string, LyricsPref> = {};
const EMPTY_PREF: LyricsPref = {};

const store = createJsonStore(
  "timbre:lyrics-prefs",
  EMPTY,
  (stored) => (typeof stored === "object" ? (stored as Record<string, LyricsPref>) : EMPTY),
  { crossTab: false },
);

export function songKey(title: string, artist: string): string {
  return `${title}::${artist}`.toLowerCase();
}

export function useLyricsPref(key: string): LyricsPref {
  return useLocalStore(store)[key] ?? EMPTY_PREF;
}

function update(key: string, change: LyricsPref): void {
  const all = store.getSnapshot();
  const next = { ...all, [key]: { ...all[key], ...change } };
  const keys = Object.keys(next);
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete next[old];
  store.save(next);
}

export function setLyricsId(key: string, id: number | undefined): void {
  update(key, { id, offset: undefined, provider: undefined });
}

export function setLyricsProvider(key: string, provider: LyricsProvider): void {
  update(key, { provider: provider === "ytmusic" ? provider : undefined, offset: undefined });
}

export function setLyricsOffset(key: string, offset: number): void {
  const rounded = Math.round(offset * 10) / 10;
  update(key, { offset: rounded === 0 ? undefined : rounded });
}

export function clearLyricsPref(key: string): void {
  const next = { ...store.getSnapshot() };
  delete next[key];
  store.save(next);
}
