import "server-only";

import { normalizeLoose } from "@timbre/core";

import { deezer } from "./deezer";
import { deezerIdFrom, findArtist } from "./discography";
import { dominantGenre } from "./genre-tally";

/*
 * What Explore needs to know about an artist someone played: which genre they are, and what
 * they put out lately. One artist per call, named by the browser from its own history — the
 * history itself never comes here, only a name at a time, which is what a search sends.
 */

export interface TasteRelease {
  id: number;
  title: string;
  artist: string;
  /** `album`, `single`, `ep` — Deezer's own record types. */
  kind: string;
  /** `YYYY-MM-DD`, as Deezer publishes it. */
  date: string;
  coverUrl: string | null;
}

export interface ArtistTaste {
  /** Deezer's spelling, which may differ from the upload's. */
  name: string;
  genreId: number | null;
  /** The newest few, newest first. The browser decides what counts as recent. */
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

/** How many of the newest releases travel back — enough to skip a deluxe reissue or two. */
const RELEASES = 3;

/**
 * Identical once normalised, or one contained in the other as whole words — "Weezer" in
 * "Weezer - Topic". Whole words, because a bare substring puts "so" in "Sonic Youth".
 */
function sameArtist(asked: string, found: string): boolean {
  const a = normalizeLoose(asked);
  const b = normalizeLoose(found);
  if (!a || !b) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return ` ${longer} `.includes(` ${shorter} `);
}

/**
 * The artist a history entry names, or null when no Deezer artist plausibly is them.
 *
 * `findArtist` always returns *somebody*, which is right for a page someone asked for and
 * wrong here: a YouTube channel name mis-read as an artist would file its whole history
 * under a stranger's genre. So the name must match, once normalised, or contain the other.
 */
export async function fetchArtistTaste(name: string): Promise<ArtistTaste | null> {
  const artist = await findArtist(name);
  const id = deezerIdFrom(artist?.url);
  if (!artist || !id) return null;

  if (!sameArtist(name, artist.name)) return null;

  // The same path and cache as the artist page's discography, so one warms the other.
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
