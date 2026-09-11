import { createLocalStore, useLocalStore } from "../local-store.ts";
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

const HISTORY_KEY = "timbre:history";

const LIMIT = 50;

const EMPTY: PlayedSong[] = [];

function isPlayed(value: unknown): value is PlayedSong {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<PlayedSong>;
  return (
    typeof entry.id === "string" &&
    typeof entry.title === "string" &&
    Array.isArray(entry.artists) &&
    entry.artists.every((artist) => typeof artist === "string") &&
    (entry.artworkUrl == null || typeof entry.artworkUrl === "string")
  );
}

function read(): PlayedSong[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    const entries = parsed.filter(isPlayed);
    return entries.length > 0 ? entries : EMPTY;
  } catch {
    return EMPTY;
  }
}

const store = createLocalStore<PlayedSong[]>({
  read,
  initial: EMPTY,
  write: (next) => window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next)),
  keys: [HISTORY_KEY],
});

export const subscribeHistory = store.subscribe;
export const getHistorySnapshot = store.getSnapshot;
export const getHistoryServerSnapshot = store.getServerSnapshot;

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
