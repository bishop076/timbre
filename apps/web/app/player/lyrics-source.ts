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

export function readAnswer(status: number, retryAfter: string | null, body: unknown): LyricsAnswer {
  const wait = busySeconds(status, retryAfter);
  if (wait !== null) return { kind: "busy", retryAfterSeconds: wait };
  if (status < 200 || status >= 300) return { kind: "failed" };

  const lyrics = body && typeof body === "object" ? (body as { lyrics?: unknown }).lyrics : null;
  return lyrics && typeof lyrics === "object" ? { kind: "found", lyrics: lyrics as Lyrics } : { kind: "none" };
}

export function retryDelayMs(retryAfterSeconds: number): number {
  return Math.min(300, Math.max(5, retryAfterSeconds)) * 1000;
}
