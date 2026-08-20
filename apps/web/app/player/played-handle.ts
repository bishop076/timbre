import type { Song } from "../types";

/** Where a play actually happened: the source and the handle that reaches it again. */
export interface PlayedHandle {
  source: string;
  sourceId: string;
  url: string | null;
}

/**
 * Which of a song's sources was the one that played — or, when none of them was, the copy
 * search found instead.
 *
 * Extracted from the player because it is only reachable there through a real `playing`
 * event, and **headless Chrome never starts an iframe player**, so the YouTube branch
 * cannot be driven in the browser harness at all. Three separate history bugs have come
 * from this handful of lines; they are worth a test.
 */
export function playedHandle(
  song: Song,
  activeSource: string | null,
  videoId: string | null,
): PlayedHandle | null {
  const played = song.sources.find((source) => source.source === activeSource);
  if (played) {
    return { source: played.source, sourceId: played.sourceId, url: played.url ?? null };
  }

  // A song reached through search — a rescued history row, or one whose own copies all
  // refused — plays on an upload it never carried, and `videoId` is the only handle to it.
  // Recording nothing there wrote the row back exactly as sourceless as it arrived, so the
  // next play paid for the same search again.
  if (activeSource === "ytmusic" && videoId) {
    return {
      source: "ytmusic",
      sourceId: videoId,
      url: `https://music.youtube.com/watch?v=${videoId}`,
    };
  }

  return null;
}
