import type { SearchContext } from "./types.ts";
import { createSidecarCall, type YtMusicConfig } from "./ytmusic.ts";

interface SidecarLyrics {
  source: string;
  synced: boolean;
  lines: { text: string; start_ms: number | null }[];
  attribution: string | null;
}

export interface TimedLyricLine {
  at: number;
  text: string;
}

export interface YtMusicLyrics {
  synced: TimedLyricLine[] | null;
  plain: string;
  attribution: string | null;
}

export function toYtMusicLyrics(raw: SidecarLyrics): YtMusicLyrics | null {
  const lines = Array.isArray(raw.lines) ? raw.lines : [];
  if (!lines.some((line) => line.text.trim())) return null;

  const timed = raw.synced && lines.every((line) => typeof line.start_ms === "number");

  return {
    synced: timed ? lines.map((line) => ({ at: (line.start_ms ?? 0) / 1000, text: line.text })) : null,
    plain: lines.map((line) => line.text).join("\n"),
    attribution: raw.attribution?.trim() || null,
  };
}

const LYRICS_DEADLINE_MS = 10_000;

export interface YtMusicLyricsQuery {
  videoIds: readonly string[];
  title: string;
  artist: string;
}

export function createYtMusicLyrics(
  config: YtMusicConfig,
): (ctx: SearchContext, query: YtMusicLyricsQuery) => Promise<YtMusicLyrics | null> {
  const call = createSidecarCall(config, LYRICS_DEADLINE_MS);
  return async (ctx, { videoIds, title, artist }) =>
    toYtMusicLyrics(
      await call<SidecarLyrics>(ctx, "/lyrics", { video_ids: videoIds, title, artist }),
    );
}
