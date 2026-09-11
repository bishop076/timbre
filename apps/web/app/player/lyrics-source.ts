// Which lyrics provider a song is read from, and what its answer meant. Kept apart from the
// panel so the decisions — when YouTube Music is on offer at all, and how "busy" differs from
// "none" — can be tested without a browser.

import type { SourceTrack } from "../types";

/** LRCLIB by default; YouTube Music when the reader chose it and the song has an upload. */
export type LyricsProvider = "lrclib" | "ytmusic";

export const PROVIDER_NAMES: Record<LyricsProvider, string> = {
  lrclib: "LRCLIB",
  ytmusic: "YouTube Music",
};

export interface LyricLine {
  at: number;
  text: string;
}

/** Either route's answer. The two share one shape so the panel draws both the same way. */
export interface Lyrics {
  instrumental: boolean;
  synced: LyricLine[] | null;
  plain: string | null;
  /** LRCLIB's record. YouTube Music files lyrics by upload, so it has no match to report. */
  matchedTitle?: string;
  matchedArtist?: string;
  id?: number;
  /** The licensor's credit, as YouTube Music words it — "Source: LyricFind". */
  attribution?: string | null;
}

export type LyricsAnswer =
  | { kind: "found"; lyrics: Lyrics }
  | { kind: "none" }
  /** Refused for now — LRCLIB's back-off, or Timbre's own meter. Worth asking again. */
  | { kind: "busy"; retryAfterSeconds: number }
  /** The provider could not be reached. Not "no lyrics": the words may well exist. */
  | { kind: "failed" };

/** What to assume when a refusal forgets to say how long it lasts. */
const DEFAULT_BUSY_SECONDS = 30;

/** As many art tracks as the lyrics route takes. Each without a lyrics page costs a second. */
const MAX_ART_TRACKS = 3;

/** The auto-generated "Topic" upload of a song — the only kind with a lyrics page. */
const ART_TRACK = "MUSIC_VIDEO_TYPE_ATV";

type Upload = Pick<SourceTrack, "source" | "sourceId" | "videoType">;

/** Whether the song has a YouTube copy — the condition for offering YouTube Music's lyrics.
 * The playing upload counts even if the song never listed it: it can be a copy found after
 * every listed one was refused. */
export function hasYouTube(sources: readonly Upload[], playing: string | null): boolean {
  return Boolean(playing) || sources.some((source) => source.source === "ytmusic" && source.sourceId);
}

/**
 * The song's art tracks, for the lyrics route to try before it searches for one — at most
 * three, the playing one first.
 *
 * **Only art tracks.** Measured 2026-09-11 across seven songs: every art track had a lyrics
 * page, and none of 14 official videos or 26 user uploads did. Timbre plays videos first,
 * since art tracks are the uploads most often barred from embedding, so the upload playing is
 * usually one with nothing to ask about; sending it would spend a second learning that. An
 * upload of unknown kind — a song saved before `videoType` was read — is left out for the same
 * reason, and the sidecar's search finds the art track instead. Empty is a normal answer.
 */
export function artTrackIds(sources: readonly Upload[], playing: string | null): string[] {
  const ids = sources
    .filter((source) => source.source === "ytmusic" && source.videoType === ART_TRACK && source.sourceId)
    .map((source) => source.sourceId)
    // `sort` is stable, so the others keep the order search gave them.
    .sort((a, b) => Number(b === playing) - Number(a === playing));
  return [...new Set(ids)].slice(0, MAX_ART_TRACKS);
}

/**
 * The provider that will actually be asked. A stored choice of YouTube Music is honoured only
 * while the song has a YouTube copy; otherwise LRCLIB answers — and the choice is left stored,
 * so it applies again when the same song plays from YouTube.
 */
export function activeProvider(stored: unknown, youtube: boolean): LyricsProvider {
  return stored === "ytmusic" && youtube ? "ytmusic" : "lrclib";
}

/**
 * Seconds to wait when a lyrics route said "later", or null when it did not. 503 is LRCLIB's
 * back-off relayed; 429 is Timbre's own meter. Both mean "not now" rather than "no".
 */
export function busySeconds(status: number, retryAfter: string | null): number | null {
  if (status !== 429 && status !== 503) return null;
  const seconds = Number(retryAfter);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_BUSY_SECONDS;
}

/** Reads a lyrics route's response into what the panel shows. */
export function readAnswer(status: number, retryAfter: string | null, body: unknown): LyricsAnswer {
  const wait = busySeconds(status, retryAfter);
  if (wait !== null) return { kind: "busy", retryAfterSeconds: wait };
  if (status < 200 || status >= 300) return { kind: "failed" };

  const lyrics = body && typeof body === "object" ? (body as { lyrics?: unknown }).lyrics : null;
  return lyrics && typeof lyrics === "object" ? { kind: "found", lyrics: lyrics as Lyrics } : { kind: "none" };
}

/**
 * How long to wait before asking again after "busy": what the server said, within reason. At
 * least five seconds, so a server saying "1" cannot pull the panel into a loop; at most five
 * minutes, so a long hold is re-checked rather than waited out blind.
 */
export function retryDelayMs(retryAfterSeconds: number): number {
  return Math.min(300, Math.max(5, retryAfterSeconds)) * 1000;
}
