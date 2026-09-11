import "server-only";

import { normalizeLoose } from "@timbre/core";

import { deezer } from "./deezer";
import { deezerIdFrom, findArtist } from "./discography";
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

interface RawAlbum {
  id: number;
  title: string;
  genre_id?: number;
  record_type?: string;
  release_date?: string;
  cover_medium?: string;
}

const RELEASES = 3;

function sameArtist(asked: string, found: string): boolean {
  const a = normalizeLoose(asked);
  const b = normalizeLoose(found);
  if (!a || !b) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return ` ${longer} `.includes(` ${shorter} `);
}

export async function fetchArtistTaste(name: string): Promise<ArtistTaste | null> {
  const artist = await findArtist(name);
  const id = deezerIdFrom(artist?.url);
  if (!artist || !id) return null;

  if (!sameArtist(name, artist.name)) return null;

  const albums = await deezer<{ data?: RawAlbum[] }>(`/artist/${id}/albums?limit=100`);
  const newest = (albums?.data ?? [])
    .slice()
    .sort((a, b) => (b.release_date ?? "").localeCompare(a.release_date ?? ""));

  return {
    name: artist.name,
    genreId: dominantGenre(newest.map((album) => album.genre_id)),
    releases: newest
      .filter((album) => album.release_date)
      .slice(0, RELEASES)
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
