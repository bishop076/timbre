import { createJsonStore, useLocalStore } from "../local-store.ts";
import { usableArtwork } from "../song-shape.ts";
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

// A playlist and a liked song are read back through `usableSong`, which keeps a cover only
// on a host `/api/art` serves. History and the play log had their own weaker check — any
// string passed — so a cover this browser stored before that rule existed, or picked up
// from a source that names a third-party host, kept being drawn from that host on every
// visit. Hold them to the same rule.
function played(entry: Partial<PlayedSong> | null): PlayedSong | null {
  if (!isPlayed(entry)) return null;
  const artworkUrl = usableArtwork(entry.artworkUrl);
  return artworkUrl === entry.artworkUrl ? entry : { ...entry, artworkUrl };
}

const store = createJsonStore("timbre:history", EMPTY, (stored) => {
  const entries = Array.isArray(stored)
    ? stored.map(played).filter((entry): entry is PlayedSong => entry !== null)
    : [];
  return entries.length > 0 ? entries : EMPTY;
});

export const getHistorySnapshot = store.getSnapshot;

/**
 * Appends a backup's recently-played list to this browser's, skipping songs already in it,
 * and returns how many were new. History carries no timestamps, so imported entries land
 * behind what this browser played itself rather than being interleaved by guesswork.
 */
export function importHistory(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  const incoming = value.map(played).filter((entry): entry is PlayedSong => entry !== null);
  if (incoming.length === 0) return 0;

  const current = getHistorySnapshot();
  const seen = new Set(current.map((entry) => entry.id));
  const merged = [...current];
  for (const entry of incoming) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    merged.push(entry);
  }

  const next = merged.slice(0, LIMIT);
  if (next.length === current.length) return 0;
  store.save(next);
  return next.length - current.length;
}

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
