import { createJsonStore, useLocalStore } from "../local-store.ts";
import { logPlay } from "../stats/play-log.ts";
import type { PlayContext } from "../types";

export interface PlayedSong {
  id: string;
  title: string;
  artists: string[];
  artworkUrl: string | null;
  videoId: string | null;
  source?: string;
  sourceId?: string;
  url?: string | null;
  from?: PlayContext;
}

const LIMIT = 50;
const EMPTY: PlayedSong[] = [];

function isPlayed(entry: Partial<PlayedSong> | null): entry is PlayedSong {
  return (
    typeof entry?.id === "string" &&
    typeof entry.title === "string" &&
    Array.isArray(entry.artists) &&
    entry.artists.every((artist) => typeof artist === "string") &&
    (entry.artworkUrl == null || typeof entry.artworkUrl === "string")
  );
}

const store = createJsonStore("timbre:history", EMPTY, (stored) => {
  const entries = Array.isArray(stored) ? stored.filter(isPlayed) : [];
  return entries.length > 0 ? entries : EMPTY;
});

export const getHistorySnapshot = store.getSnapshot;

export function useHistory(): PlayedSong[] {
  return useLocalStore(store);
}

export function recordPlay(song: PlayedSong): void {
  logPlay(song);

  const current = getHistorySnapshot();
  const front = current[0];
  if (front?.id === song.id && front.source === song.source && front.sourceId === song.sourceId) {
    return;
  }
  store.save([song, ...current.filter((entry) => entry.id !== song.id)].slice(0, LIMIT));
}
