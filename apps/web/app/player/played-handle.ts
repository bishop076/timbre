import type { Song } from "../types";

export function playedHandle(song: Song, activeSource: string | null, videoId: string | null) {
  const played = song.sources.find((source) => source.source === activeSource);
  if (played) return { source: played.source, sourceId: played.sourceId, url: played.url ?? null };

  if (activeSource === "ytmusic" && videoId) {
    const url = `https://music.youtube.com/watch?v=${videoId}`;
    return { source: "ytmusic", sourceId: videoId, url };
  }
  return null;
}
