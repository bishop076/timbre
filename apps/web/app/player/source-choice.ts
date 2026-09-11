import { dedupeKey } from "@timbre/core";

import type { Song } from "../types";

type Playback = "queue" | "manual" | "preview" | null;

export type SourceChoices = Readonly<Record<string, string>>;

const KEY = "timbre:source-choice";

export const MAX_ENTRIES = 200;

export function choiceKey(song: Pick<Song, "title" | "artists">): string {
  return dedupeKey(song.title, song.artists);
}

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
  if (playback !== "queue") return choices;
  if (choices[key] === source) return choices;

  const next: Record<string, string> = { ...without(choices, key), [key]: source };
  const keys = Object.keys(next);
  if (keys.length > MAX_ENTRIES) {
    for (const stale of keys.slice(0, keys.length - MAX_ENTRIES)) delete next[stale];
  }
  return next;
}

export function afterFailure(choices: SourceChoices, key: string, source: string): SourceChoices {
  return choices[key] === source ? without(choices, key) : choices;
}

let cache: SourceChoices | null = null;

function read(): SourceChoices {
  if (cache) return cache;
  const found: Record<string, string> = {};
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(KEY) ?? "{}");
    if (parsed && typeof parsed === "object") {
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string") found[key] = value;
      }
    }
  } catch {
  }
  cache = found;
  return cache;
}

function save(next: SourceChoices): void {
  if (next === cache) return;
  cache = next;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
  }
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
