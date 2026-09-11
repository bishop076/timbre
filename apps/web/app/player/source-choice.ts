/**
 * The source a reader picked for a song, remembered for the rest of this tab's session — so
 * replaying it later, from history, a playlist or the queue, starts where they sent it.
 *
 * **A pick is a workaround, not a taste, so it is kept for the session and no longer.** G-17
 * put it plainly: someone who presses SoundCloud once is rarely saying they prefer SoundCloud
 * — they can see the default failing, usually because of where the connection comes out.
 * That condition belongs to the session. In `localStorage` a pick would outlive the VPN exit
 * that prompted it and hold the song to a second-best copy for weeks, with nothing on screen
 * saying why this row no longer starts where every other row does.
 *
 * **Keyed on the recording, by the merger's own identity.** `dedupeKey` — base title,
 * variants, credited artists — is what `merge.ts` falls back to without an ISRC, and what
 * `sameTrack` compares. `songKey` in `lyrics-prefs.ts` keys on the raw title, which splits one
 * recording between *As It Was* and *As It Was (Official Video)*, so a pick made on a search
 * row would miss the same song on a chart. Variants still count: choosing SoundCloud for a
 * live take says nothing about the studio cut.
 *
 * **What a pick does.**
 * - A source that plays the whole song and advances by itself (`queue`) is remembered. It is
 *   the only kind worth replaying unattended.
 * - YouTube Music forgets. It is where the ladder starts anyway, so pressing it is the reader
 *   going back to the default.
 * - A clip, or an embed that has to be pressed, leaves things as they were. Both are choices
 *   for the moment: a remembered clip would turn a whole song into thirty seconds for the rest
 *   of the session, and a remembered embed would stall an unattended queue on it.
 *
 * The remembered source failing forgets it too — see {@link afterFailure}. A song that simply
 * does not carry the remembered source is left alone rather than forgotten: an album row holds
 * only Deezer, and the pick still holds for the search result that carries SoundCloud.
 */

import { dedupeKey } from "@timbre/core";

import type { Song } from "../types";

/** What `playbackFrom` says of a source. Repeated rather than imported: the player context is
 * a React module, and this one has to load under `node --test`. */
type Playback = "queue" | "manual" | "preview" | null;

/** Recording key → source id, oldest first. */
export type SourceChoices = Readonly<Record<string, string>>;

const KEY = "timbre:source-choice";

/** Bounded like `lyrics-prefs.ts`, though a session rarely comes near it: this is a tab that
 * could be left open for a week. */
export const MAX_ENTRIES = 200;

/** The recording, not the queue's object — see the note above. */
export function choiceKey(song: Pick<Song, "title" | "artists">): string {
  return dedupeKey(song.title, song.artists);
}

function without(choices: SourceChoices, key: string): SourceChoices {
  if (!(key in choices)) return choices;
  const next = { ...choices };
  delete next[key];
  return next;
}

/** What pressing `source` does to the map. Returns the same object when nothing changes. */
export function afterPick(
  choices: SourceChoices,
  key: string,
  source: string,
  playback: Playback,
): SourceChoices {
  if (source === "ytmusic") return without(choices, key);
  if (playback !== "queue") return choices;
  if (choices[key] === source) return choices;

  // Re-inserted at the end, so insertion order is recency and eviction takes the oldest.
  const next: Record<string, string> = { ...without(choices, key), [key]: source };
  const keys = Object.keys(next);
  if (keys.length > MAX_ENTRIES) {
    for (const stale of keys.slice(0, keys.length - MAX_ENTRIES)) delete next[stale];
  }
  return next;
}

/** Forgets `source` for this song if it is still the one remembered. A failure of something
 * else — a clip pressed on top of a remembered SoundCloud — says nothing about SoundCloud. */
export function afterFailure(choices: SourceChoices, key: string, source: string): SourceChoices {
  return choices[key] === source ? without(choices, key) : choices;
}

/** Parsed once per page; `sessionStorage` is this tab's alone, so nothing else writes it. */
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
    // Blocked storage, or a malformed value: start empty, which is just the ladder.
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
    // Quota, or storage blocked. The pick still holds until the page reloads.
  }
}

/** The source picked for this recording earlier in the session, if any. */
export function rememberedSource(song: Song): string | undefined {
  return read()[choiceKey(song)];
}

/** Records a press on a source badge. `playback` is `playbackFrom(song, source)`. */
export function pickSource(song: Song, source: string, playback: Playback): void {
  save(afterPick(read(), choiceKey(song), source, playback));
}

/** The picked source failed to play this song. */
export function forgetFailedSource(song: Song, source: string): void {
  save(afterFailure(read(), choiceKey(song), source));
}
