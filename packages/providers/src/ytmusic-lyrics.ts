/*
 * YouTube Music's own lyrics, via the sidecar — the second lyrics source beside LRCLIB, and
 * the only other one that needs no key. Licensed rather than community-typed, with the
 * licensor credited, and timed when YouTube Music has timings. Filed under a song's art track,
 * which the sidecar finds when the web app does not already know it.
 */

import type { SearchContext } from "./types.ts";
import { createSidecarCall, type YtMusicConfig } from "./ytmusic.ts";

/** What the sidecar's `/lyrics` answers. Always a 200; empty `lines` means none. */
interface SidecarLyrics {
  source: string;
  synced: boolean;
  lines: { text: string; start_ms: number | null }[];
  attribution: string | null;
}

export interface TimedLyricLine {
  /** Seconds into the song. */
  at: number;
  text: string;
}

export interface YtMusicLyrics {
  /** Ascending. Null when YouTube Music has the words but not their timing. */
  synced: TimedLyricLine[] | null;
  /** The words as one text, stanza breaks kept. Present either way. */
  plain: string;
  /** The licensor's credit as YouTube Music words it — "Source: LyricFind". */
  attribution: string | null;
}

/** The sidecar's answer in the shape the lyrics panel reads, or null for "no lyrics". */
export function toYtMusicLyrics(raw: SidecarLyrics): YtMusicLyrics | null {
  const lines = Array.isArray(raw.lines) ? raw.lines : [];
  // Blank lines are kept as stanza breaks and timed gaps, so a list can be all of them.
  if (!lines.some((line) => line.text.trim())) return null;

  // Timed only if every line is. A partly-timed list cannot be highlighted honestly, and the
  // sidecar never sends one — this is the check that keeps it that way on the web side.
  const timed = raw.synced && lines.every((line) => typeof line.start_ms === "number");

  return {
    synced: timed ? lines.map((line) => ({ at: (line.start_ms ?? 0) / 1000, text: line.text })) : null,
    plain: lines.map((line) => line.text).join("\n"),
    attribution: raw.attribution?.trim() || null,
  };
}

/**
 * Longer than a search's six seconds, because this is several upstream calls in a row: watch
 * pages for known art tracks, a songs search when none has lyrics, the found track's watch
 * page, then the lyrics page. Measured 2026-09-11: ~1.2s per warm watch page, 0.6-1s per songs
 * search, 0.4s for a warm lyrics page — and 2.3s and 1.7s for the first watch and lyrics pages
 * on cold clients. A cold worst case passes six seconds, and a deadline inside the worst case
 * turns the slowest answer into a failure every time.
 */
const LYRICS_DEADLINE_MS = 10_000;

export interface YtMusicLyricsQuery {
  /** Art tracks of the song already known, in the order to try them. At most three. */
  videoIds: readonly string[];
  /** For finding the art track when none of those has lyrics. */
  title: string;
  artist: string;
}

/** Asks the sidecar for one song's lyrics. See `LyricsRequest` in the sidecar's models for
 * why art tracks, and why a title and artist alongside them. */
export function createYtMusicLyrics(
  config: YtMusicConfig,
): (ctx: SearchContext, query: YtMusicLyricsQuery) => Promise<YtMusicLyrics | null> {
  const call = createSidecarCall(config, LYRICS_DEADLINE_MS);
  return async (ctx, { videoIds, title, artist }) =>
    toYtMusicLyrics(
      await call<SidecarLyrics>(ctx, "/lyrics", { video_ids: videoIds, title, artist }),
    );
}
