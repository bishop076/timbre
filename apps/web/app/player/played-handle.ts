import type { Song } from "../types";

export interface PlayedHandle {
  source: string;
  sourceId: string;
  url: string | null;
}

export function playedHandle(
  song: Song,
  activeSource: string | null,
  videoId: string | null,
): PlayedHandle | null {
  const played = song.sources.find((source) => source.source === activeSource);
  if (played) {
    return { source: played.source, sourceId: played.sourceId, url: played.url ?? null };
  }

  if (activeSource === "ytmusic" && videoId) {
    return {
      source: "ytmusic",
      sourceId: videoId,
      url: `https://music.youtube.com/watch?v=${videoId}`,
    };
  }

  return null;
}
