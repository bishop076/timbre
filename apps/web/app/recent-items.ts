import type { PlayedSong } from "./player/history-store";
import type { PlayContext } from "./types";

export type RecentItem =
  | { kind: "song"; entry: PlayedSong }
  | {
      kind: "artist";
      artist: PlayContext;
      entries: PlayedSong[];
    };

function artistOf(entry: PlayedSong): PlayContext | null {
  const from = entry.from as Partial<PlayContext> | undefined;
  if (from?.kind !== "artist" || typeof from.name !== "string" || !from.name.trim()) return null;
  return {
    kind: "artist",
    name: from.name.trim(),
    imageUrl: typeof from.imageUrl === "string" ? from.imageUrl : null,
  };
}

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
