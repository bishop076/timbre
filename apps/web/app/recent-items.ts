import type { PlayedSong } from "./player/history-store";
import type { PlayContext } from "./types";

/*
 * What "Recently played" shows: the history, with every song played from an artist's page
 * folded into one tile for that artist. Ten songs played from one artist were ten tiles of the
 * same face; what the listener did was play that artist. Pure, so it is tested rather than
 * eyeballed — the history is local storage, and outlives the code that wrote it.
 */

export type RecentItem =
  | { kind: "song"; entry: PlayedSong }
  | {
      kind: "artist";
      artist: PlayContext;
      /** Every song of theirs in the history that was played from their page, newest first. */
      entries: PlayedSong[];
    };

/** The artist a row was played from, if it names one properly. Stored data is not trusted. */
function artistOf(entry: PlayedSong): PlayContext | null {
  const from = entry.from as Partial<PlayContext> | undefined;
  if (from?.kind !== "artist" || typeof from.name !== "string" || !from.name.trim()) return null;
  return {
    kind: "artist",
    name: from.name.trim(),
    imageUrl: typeof from.imageUrl === "string" ? from.imageUrl : null,
  };
}

/**
 * Up to `limit` tiles, newest first. An artist sits where their most recent play puts them.
 * Once the row is full the scan carries on, but only to gather more of the artists already
 * shown — so an artist tile's play button plays everything of theirs you played there.
 */
export function recentItems(history: readonly PlayedSong[], limit: number): RecentItem[] {
  const items: RecentItem[] = [];
  const artists = new Map<string, Extract<RecentItem, { kind: "artist" }>>();

  for (const entry of history) {
    const artist = artistOf(entry);
    if (artist) {
      const key = artist.name.toLowerCase();
      const existing = artists.get(key);
      if (existing) {
        existing.entries.push(entry);
        continue;
      }
      if (items.length >= limit) continue;
      const item = { kind: "artist" as const, artist, entries: [entry] };
      artists.set(key, item);
      items.push(item);
      continue;
    }

    if (items.length < limit) items.push({ kind: "song", entry });
  }

  return items;
}
