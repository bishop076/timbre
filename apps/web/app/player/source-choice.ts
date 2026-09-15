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

/**
 * What this tab has stored, held to the shape *and* the size `afterPick` writes.
 *
 * `afterPick` trims to `MAX_ENTRIES` on the way out and the read took whatever it found, so a
 * value left longer by an older build or edited by hand came back at its full length and stayed:
 * a write only ever removes the excess that one write creates. `Object.entries` of an array also
 * came back as `{0: "…"}`, which made every numeric index a choice key. The tail is kept, which
 * is the end `afterPick` trims from — the most recently pressed sources.
 */
export function readChoices(parsed: unknown): SourceChoices {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const usable = Object.entries(parsed).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return Object.fromEntries(usable.slice(-MAX_ENTRIES));
}

function read(): SourceChoices {
  if (cache) return cache;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(readItem(KEY, "sessionStorage") ?? "{}");
  } catch {}
  cache = readChoices(parsed);
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
