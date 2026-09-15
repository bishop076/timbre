import { normalizeArtists, parseTitle } from "@timbre/core";

import type { SourceTrack } from "../types";

export type LyricsProvider = "lrclib" | "ytmusic";

export const PROVIDER_NAMES: Record<LyricsProvider, string> = {
  lrclib: "LRCLIB",
  ytmusic: "YouTube Music",
};

export interface Lyrics {
  instrumental: boolean;
  synced: { at: number; text: string }[] | null;
  plain: string | null;
  matchedTitle?: string;
  matchedArtist?: string;
  id?: number;
  attribution?: string | null;
}

export type LyricsAnswer =
  | { kind: "found"; lyrics: Lyrics }
  | { kind: "none" }
  | { kind: "busy"; retryAfterSeconds: number }
  | { kind: "failed" };

type Upload = Pick<SourceTrack, "source" | "sourceId" | "videoType">;

const ART_TRACK = "MUSIC_VIDEO_TYPE_ATV";

export function hasYouTube(sources: readonly Upload[], playing: string | null): boolean {
  return Boolean(playing) || sources.some((source) => source.source === "ytmusic" && source.sourceId);
}

export function artTrackIds(sources: readonly Upload[], playing: string | null): string[] {
  const ids = sources
    .filter((source) => source.source === "ytmusic" && source.videoType === ART_TRACK && source.sourceId)
    .map((source) => source.sourceId)
    .sort((a, b) => Number(b === playing) - Number(a === playing));
  return [...new Set(ids)].slice(0, 3);
}

export function activeProvider(stored: unknown, youtube: boolean): LyricsProvider {
  return stored === "ytmusic" && youtube ? "ytmusic" : "lrclib";
}

export function busySeconds(status: number, retryAfter: string | null): number | null {
  if (status !== 429 && status !== 503) return null;
  const seconds = Number(retryAfter);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 30;
}

/**
 * The timed lines, keeping only the ones that can actually drive the follow.
 *
 * `findLastIndex(line => line.at <= position)` is only an answer if every `at` is a real number
 * and the list runs forwards: one `NaN` stamp from a malformed `[mm:ss]` — or from a sidecar
 * handing back `start_ms: null` inside a list it still calls synced — makes the comparison false
 * for every line after it, and the panel stops following mid-song with no sign that anything is
 * wrong. Sorting here rather than trusting the order means an out-of-order upstream costs a
 * jumbled scroll, not a dead one.
 */
function timedLines(raw: unknown): { at: number; text: string }[] | null {
  if (!Array.isArray(raw)) return null;

  const lines = raw
    .filter(
      (line): line is { at: number; text: string } =>
        Boolean(line) &&
        typeof line === "object" &&
        Number.isFinite((line as { at?: unknown }).at) &&
        typeof (line as { text?: unknown }).text === "string",
    )
    .map((line) => ({ at: line.at, text: line.text }))
    .sort((a, b) => a.at - b.at);

  return lines.length > 0 ? lines : null;
}

/**
 * A `lyrics` object from either route, reduced to what the panel is allowed to believe.
 *
 * Answers `null` for a body that is not lyrics at all — the caller turns that into a failure,
 * because a 200 carrying something unrecognisable is not the service saying "no lyrics", it is
 * something in the middle answering instead of it.
 */
function readLyricsBody(raw: unknown): Lyrics | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const body = raw as Record<string, unknown>;
  const plain = typeof body.plain === "string" && body.plain.trim() ? body.plain : null;

  return {
    instrumental: body.instrumental === true,
    synced: timedLines(body.synced),
    plain,
    ...(typeof body.matchedTitle === "string" ? { matchedTitle: body.matchedTitle } : {}),
    ...(typeof body.matchedArtist === "string" ? { matchedArtist: body.matchedArtist } : {}),
    ...(typeof body.id === "number" ? { id: body.id } : {}),
    ...(typeof body.attribution === "string" ? { attribution: body.attribution } : {}),
  };
}

/**
 * What the response to a lyrics request actually established.
 *
 * Three answers that used to flatten into "no lyrics for this track" are separated here, because
 * the panel says that sentence as a fact about the song:
 *
 *  - a body that is not JSON, or JSON without a `lyrics` key, is `failed`. `response.json()`
 *    failing gives the reader a captive portal's HTML or a truncated body, and the old reading
 *    turned both into a statement about the song that the request never reached anything to make.
 *  - a `lyrics` value that is not an object and not `null` is `failed` for the same reason.
 *  - `lyrics` present but carrying no words and not marked instrumental is `none`: the service
 *    answered, it simply holds nothing. It used to be `found`, which rendered an empty pane under
 *    the line "No timings for this one, so it can't follow along" — a blank page with a caption.
 *
 * `{ lyrics: null }` at 200 stays what it has always been: LRCLIB looked and has nothing.
 */
export function readAnswer(status: number, retryAfter: string | null, body: unknown): LyricsAnswer {
  const wait = busySeconds(status, retryAfter);
  if (wait !== null) return { kind: "busy", retryAfterSeconds: wait };
  if (status < 200 || status >= 300) return { kind: "failed" };
  if (!body || typeof body !== "object" || !("lyrics" in body)) return { kind: "failed" };

  const raw = (body as { lyrics: unknown }).lyrics;
  if (raw === null || raw === undefined) return { kind: "none" };

  const lyrics = readLyricsBody(raw);
  if (!lyrics) return { kind: "failed" };
  if (!lyrics.instrumental && !lyrics.plain && !lyrics.synced) return { kind: "none" };
  return { kind: "found", lyrics };
}

export function retryDelayMs(retryAfterSeconds: number): number {
  return Math.min(300, Math.max(5, retryAfterSeconds)) * 1000;
}

/**
 * How much the words on screen can be trusted to belong to the song that is playing.
 *
 * `/api/lyrics` falls back to LRCLIB's fuzzy search and takes the first synced hit, so asking it
 * for "Creep" by Nirvana returns "Negative Creep" — a complete, confidently timed set of lyrics
 * to a different song, which the panel presented as this song's own. Wrong words are worse than
 * none, and the only evidence available is the title and artist the service says it matched.
 */
export type MatchQuality = "exact" | "cover" | "different" | "unknown";

export function matchQuality(
  asked: { title: string; artist: string },
  matched: { matchedTitle?: string; matchedArtist?: string },
): MatchQuality {
  const askedTitle = parseTitle(asked.title).base;
  const foundTitle = matched.matchedTitle ? parseTitle(matched.matchedTitle).base : "";
  // YouTube Music matches by video id and names no track back; there is nothing to compare, and
  // guessing "different" would cry wolf over every one of them.
  if (!askedTitle || !foundTitle) return "unknown";
  if (askedTitle !== foundTitle) return "different";

  const askedArtist = normalizeArtists([asked.artist]);
  const foundArtist = matched.matchedArtist ? normalizeArtists([matched.matchedArtist]) : [];
  if (askedArtist.length === 0 || foundArtist.length === 0) return "unknown";

  // Credits disagree about featured artists far more often than they disagree about who made the
  // record, so one name in common is enough. Nothing in common, with the same title, is a cover.
  return foundArtist.some((name) => askedArtist.includes(name)) ? "exact" : "cover";
}

/** The keys that scroll a box the reader is standing in, as opposed to the ones that act on it. */
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]);

export function isScrollKey(key: string): boolean {
  return SCROLL_KEYS.has(key);
}

/**
 * How long our own `scrollTo` may keep firing `scroll` events before the box is the reader's again.
 *
 * Wheel and touch are the only two ways of scrolling the panel used to notice, so dragging the
 * scrollbar, or paging with the keyboard, was answered by hauling the view back to the current
 * line — the follow fighting the reader with no way to win. Listening to `scroll` instead catches
 * every one of them, at the cost of hearing our own smooth scroll as though it were a reader's;
 * this window is what tells the two apart. Under `prefers-reduced-motion` the scroll lands in one
 * frame, so the window shrinks with it and a reader's next move is their own immediately.
 */
export function scrollSettleMs(behavior: ScrollBehavior): number {
  return behavior === "smooth" ? 700 : 60;
}

/**
 * Whose scroll this was, and when to stop crediting the next one to us.
 *
 * The window runs from the *last* event we recognised rather than from the `scrollTo` that began
 * it, because a smooth scroll the length of the panel keeps firing for well over half a second:
 * measured against the call, its own tail came back as a reader taking hold, so restoring the
 * follow after the six-second pause immediately cancelled it again and the button never left.
 * Once the reader does own the box we stop claiming it, and their next move needs no window.
 */
export function readScroll(
  now: number,
  scrolledAt: number | null,
  settleMs: number,
): { reader: boolean; scrolledAt: number | null } {
  return scrolledAt !== null && now - scrolledAt <= settleMs
    ? { reader: false, scrolledAt: now }
    : { reader: true, scrolledAt: null };
}
