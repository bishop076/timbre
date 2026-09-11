import type { PlayedSong } from "./player/history-store";
import type { PlayContext } from "./types";

type RecentArtist = { kind: "artist"; artist: PlayContext; entries: PlayedSong[] };
type RecentItem = { kind: "song"; entry: PlayedSong } | RecentArtist;

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
  const artists = new Map<string, RecentArtist>();

  for (const entry of history) {
    const artist = artistOf(entry);
    if (!artist) {
      if (items.length < limit) items.push({ kind: "song", entry });
      continue;
    }
    const key = artist.name.toLowerCase();
    const gathered = artists.get(key);
    if (gathered) {
      gathered.entries.push(entry);
    } else if (items.length < limit) {
      const item: RecentArtist = { kind: "artist", artist, entries: [entry] };
      artists.set(key, item);
      items.push(item);
    }
  }

  return items;
}
