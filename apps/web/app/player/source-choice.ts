import { dedupeKey } from "@timbre/core";

import { readItem, writeItem } from "../local-store.ts";
import type { Song } from "../types";

type Playback = "queue" | "manual" | "preview" | null;

export type SourceChoices = Readonly<Record<string, string>>;

const KEY = "timbre:source-choice";
export const MAX_ENTRIES = 200;

export function choiceKey(song: Pick<Song, "title" | "artists">): string {
  return dedupeKey(song.title, song.artists);
}

// Deezer and Apple play in a bare embed that reports neither progress nor the end of a track —
// `subscription-player.tsx` passes `useTransport(null)` — so a queue playing on one of them stops
// dead once the song finishes. Pressing one is fine; remembering it would strand every song after
// it, which is worse than the wrong logo. They stay a one-off until those embeds can report an end.
const STOPS_AFTER_ONE = new Set(["deezer", "apple"]);

function without(choices: SourceChoices, key: string): SourceChoices {
  if (!(key in choices)) return choices;
  const next = { ...choices };
  delete next[key];
  return next;
}

export function afterPick(
  choices: SourceChoices,
  key: string,
  source: string,
  playback: Playback,
): SourceChoices {
  if (source === "ytmusic") return without(choices, key);

  // An embed you pressed is still a choice: picking Spotify for a song means that song keeps
  // playing there until it fails (`afterFailure` drops it). Only a 30-second clip stays a
  // one-off — it is not a source anyone would want as a standing default.
  if (playback === null || playback === "preview") return choices;
  if (STOPS_AFTER_ONE.has(source)) return choices;
  if (choices[key] === source) return choices;

  const next: Record<string, string> = { ...without(choices, key), [key]: source };
  const keys = Object.keys(next);
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete next[stale];
  return next;
}

export function afterFailure(choices: SourceChoices, key: string, source: string): SourceChoices {
  return choices[key] === source ? without(choices, key) : choices;
}

let cache: SourceChoices | null = null;

function read(): SourceChoices {
  if (cache) return cache;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(readItem(KEY, "sessionStorage") ?? "{}");
  } catch {}
  const entries = parsed && typeof parsed === "object" ? Object.entries(parsed) : [];
  cache = Object.fromEntries(entries.filter(([, value]) => typeof value === "string"));
  return cache;
}

function save(next: SourceChoices): void {
  if (next === cache) return;
  cache = next;
  writeItem(KEY, JSON.stringify(next), "sessionStorage");
}

export function rememberedSource(song: Song): string | undefined {
  return read()[choiceKey(song)];
}

export function pickSource(song: Song, source: string, playback: Playback): void {
  save(afterPick(read(), choiceKey(song), source, playback));
}

export function forgetFailedSource(song: Song, source: string): void {
  save(afterFailure(read(), choiceKey(song), source));
}
