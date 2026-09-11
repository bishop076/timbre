import "server-only";

import { normalizeLoose } from "@timbre/core";

import { deezerIdFrom, fetchArtistAlbums, findArtist } from "./discography";
import { dominantGenre } from "./genre-tally";

export interface TasteRelease {
  id: number;
  title: string;
  artist: string;
  kind: string;
  date: string;
  coverUrl: string | null;
}

export interface ArtistTaste {
  name: string;
  genreId: number | null;
  releases: TasteRelease[];
}

function sameArtist(asked: string, found: string): boolean {
  const a = normalizeLoose(asked);
  const b = normalizeLoose(found);
  if (!a || !b) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return ` ${longer} `.includes(` ${shorter} `);
}

export async function fetchArtistTaste(name: string): Promise<ArtistTaste | null> {
  const artist = await findArtist(name);
  const id = deezerIdFrom(artist?.url);
  if (!artist || !id || !sameArtist(name, artist.name)) return null;

  const newest = await fetchArtistAlbums(id);

  return {
    name: artist.name,
    genreId: dominantGenre(newest.map((album) => album.genre_id)),
    releases: newest
      .filter((album) => album.release_date)
      .slice(0, 3)
      .map((album) => ({
        id: album.id,
        title: album.title,
        artist: artist.name,
        kind: album.record_type ?? "album",
        date: album.release_date!,
        coverUrl: album.cover_medium ?? null,
      })),
  };
}
