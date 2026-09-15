"use client";

import { createJsonStore, useLocalStore } from "../local-store.ts";
import type { LyricsProvider } from "./lyrics-source.ts";

interface LyricsPref {
  id?: number;
  offset?: number;
  provider?: LyricsProvider;
}

const MAX_ENTRIES = 300;
/**
 * The furthest the panel will believe a nudge has been carried. The stepper moves in half
 * seconds and has no ceiling of its own, so this is not "what a reader can reach" but "what is
 * still about this song": ten minutes is longer than almost every track, and beyond it the
 * value is indistinguishable from a hand edit.
 */
const MAX_OFFSET_S = 600;
const EMPTY: Record<string, LyricsPref> = {};
const EMPTY_PREF: LyricsPref = {};

const clamp = (value: number) => Math.max(-MAX_OFFSET_S, Math.min(MAX_OFFSET_S, value));

/**
 * One remembered choice, held to what the panel is able to use.
 *
 * Nothing was checked at all before — the parser was `typeof stored === "object"`, and every
 * value under every key went to `LyricsPanel` wearing the `LyricsPref` type without ever having
 * been one. `offset` is the sharp edge: the panel renders `offset.toFixed(1)` in the nudge row,
 * so a stored `"1"` is a `TypeError` in render and the player panel goes down with it, and a
 * stored `NaN` makes `line.at <= position + offset` false for every line, so the lyrics stop
 * following with nothing on screen to say why. `localStorage` is hand-editable, and this key is
 * written by one tab while another reads it, so neither needs a bug upstream to happen.
 */
function usablePref(value: unknown): LyricsPref | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;

  const id = typeof raw.id === "number" && Number.isInteger(raw.id) && raw.id > 0 ? raw.id : undefined;
  const offset =
    typeof raw.offset === "number" && Number.isFinite(raw.offset) && raw.offset !== 0
      ? clamp(Math.round(raw.offset * 10) / 10)
      : undefined;
  const provider = raw.provider === "ytmusic" ? ("ytmusic" as const) : undefined;

  if (id === undefined && offset === undefined && provider === undefined) return null;
  return {
    ...(id === undefined ? {} : { id }),
    ...(offset === undefined ? {} : { offset }),
    ...(provider === undefined ? {} : { provider }),
  };
}

/**
 * What this browser has stored, held to the shape *and* the size the app writes.
 *
 * `update` trims to `MAX_ENTRIES` on the way out and the read took whatever it found, so a file
 * left longer by an older build, by a hand edit or by a tab running different code came back at
 * its full length and stayed there: a write only ever removes the excess that one write creates.
 * The tail is what is kept, matching the end the write path trims from.
 *
 * Entries carrying nothing are dropped rather than counted. `setLyricsOffset(key, 0)` stores
 * `{}` — the cleared state is an empty object, not a missing key — so a reader who nudged and
 * undid a hundred songs was spending a third of the cap on choices that no longer exist.
 */
export function readPrefs(stored: unknown): Record<string, LyricsPref> {
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return EMPTY;

  const entries: [string, LyricsPref][] = [];
  for (const [key, value] of Object.entries(stored)) {
    const pref = usablePref(value);
    if (pref) entries.push([key, pref]);
  }
  if (entries.length === 0) return EMPTY;
  return Object.fromEntries(entries.slice(-MAX_ENTRIES));
}

const store = createJsonStore("timbre:lyrics-prefs", EMPTY, readPrefs, { crossTab: false });

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
  const rounded = Number.isFinite(offset) ? Math.round(clamp(offset) * 10) / 10 : 0;
  update(key, { offset: rounded === 0 ? undefined : rounded });
}

export function clearLyricsPref(key: string): void {
  const next = { ...store.getSnapshot() };
  delete next[key];
  store.save(next);
}
