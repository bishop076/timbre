import type { SearchContext } from "./types.ts";
import { createSidecarCall, type YtMusicConfig } from "./ytmusic.ts";

interface SidecarLyrics {
  synced: boolean;
  lines: { text: string; start_ms: number | null }[];
  attribution: string | null;
}

export function toYtMusicLyrics(raw: SidecarLyrics) {
  // `lines` was already checked for being an array; the lines inside it were not, so one entry
  // without a `text` threw `Cannot read properties of undefined (reading 'trim')` — a raw
  // TypeError out of a provider, where every other failure here is a typed one.
  const lines = (Array.isArray(raw?.lines) ? raw.lines : []).filter((line) => typeof line?.text === "string");
  if (!lines.some((line) => line.text.trim())) return null;

  const timed = raw.synced && lines.every((line) => typeof line.start_ms === "number");
  return {
    synced: timed ? lines.map((line) => ({ at: (line.start_ms ?? 0) / 1000, text: line.text })) : null,
    plain: lines.map((line) => line.text).join("\n"),
    attribution: typeof raw.attribution === "string" ? raw.attribution.trim() || null : null,
  };
}

export function createYtMusicLyrics(config: YtMusicConfig) {
  const call = createSidecarCall(config, 10_000);
  return async (
    ctx: SearchContext,
    { videoIds, title, artist }: { videoIds: readonly string[]; title: string; artist: string },
  ) => {
    const raw = await call<SidecarLyrics>(ctx, "/lyrics", { video_ids: videoIds, title, artist });
    return toYtMusicLyrics(raw);
  };
}
