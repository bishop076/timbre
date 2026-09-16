import "server-only";

import { normalizeLoose } from "@timbre/core";
import { z } from "zod";

import {
  deezerList,
  deezerListOrFail,
  deezerOrFail,
  deezerRows,
  DeezerUnavailable,
  newestFirst,
  rawTrackSchema,
} from "./deezer";
import type { LinkedSong } from "./discover";

export interface Release {
  id: number;
  title: string;
  kind: string;
  year: string | null;
  coverUrl: string | null;
  trackCount: number | null;
}

export interface RelatedArtist {
  name: string;
  imageUrl: string | null;
}

export interface AlbumDetail extends Omit<Release, "trackCount"> {
  artist: string;
  trackCount: number;
  songs: LinkedSong[];
}

/**
 * Deezer's album rows, parsed rather than asserted.
 *
 * This was an `interface` and a cast, which is a promise about somebody else's server, and
 * `/artist/<id>/albums` broke it: Deezer answered `200` with one row carrying no `title`, and
 * the dedupe below reads `album.title.trim()` on every row before anything else looks at one.
 * `TypeError: Cannot read properties of undefined (reading 'trim')` out of a well-formed
 * request is `/api/artist?full=1` and `/api/taste` answering `500`, and `/artist/<name>`
 * rendering its error boundary, over a discography Deezer sent in full bar one row.
 *
 * `id` and `title` are required because every entry below is built around them; a row without
 * one is dropped, one release short rather than the whole shelf. Everything else is `nullish`,
 * because an album legitimately has no release date, no genre and no cover.
 */
const albumSchema = z.object({
  id: z.number(),
  title: z.string(),
  genre_id: z.number().nullish(),
  record_type: z.string().nullish(),
  release_date: z.string().nullish(),
  cover_medium: z.string().nullish(),
  nb_tracks: z.number().nullish(),
});

export type DeezerAlbum = z.output<typeof albumSchema>;

const albumDetailSchema = albumSchema.extend({
  cover_big: z.string().nullish(),
  artist: z.object({ name: z.string().nullish() }).nullish(),
  tracks: deezerRows(rawTrackSchema).nullish(),
});

const relatedSchema = z.object({ name: z.string(), picture_medium: z.string().nullish() });

const artistSchema = z.object({
  name: z.string(),
  picture_medium: z.string().nullish(),
  picture_xl: z.string().nullish(),
  nb_fan: z.number().nullish(),
  link: z.string().nullish(),
});

export function deezerIdFrom(url: string | null | undefined): string | null {
  const match = url ? /deezer\.com\/(?:[a-z]{2}\/)?artist\/(\d+)/.exec(url) : null;
  return match ? match[1]! : null;
}

/**
 * Strict, for the same reason `deezerListOrFail` exists above. The album list *is* the answer to
 * "what has this artist released" — `/api/artist?full=1` fills the search page's Albums panel
 * from it and `/api/taste` its release shelf, and both serve it under a day of `s-maxage` with a
 * week of `stale-while-revalidate` behind that. Forgiven into `[]`, one Deezer blip on this one
 * read published "this artist has released nothing" to every reader for a day. The related-artist
 * shelf below stays forgiving: an empty shelf is a shelf, an empty discography is a claim.
 */
export async function fetchArtistAlbums(id: string): Promise<DeezerAlbum[]> {
  return (
    await deezerListOrFail(`/artist/${id}/albums?limit=100`, albumSchema)
  ).toSorted(newestFirst);
}

export async function fetchDiscography(
  artistUrl: string | null | undefined,
): Promise<{ releases: Release[]; related: RelatedArtist[] }> {
  const id = deezerIdFrom(artistUrl);
  if (!id) return { releases: [], related: [] };

  const [albums, related] = await Promise.all([
    fetchArtistAlbums(id),
    deezerList(`/artist/${id}/related?limit=12`, relatedSchema),
  ]);

  const seen = new Set<string>();
  return {
    releases: albums
      .filter((album) => {
        const key = album.title.trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((album) => ({
        id: album.id,
        title: album.title,
        kind: album.record_type ?? "album",
        year: album.release_date?.slice(0, 4) || null,
        coverUrl: album.cover_medium ?? null,
        trackCount: album.nb_tracks ?? null,
      })),
    related: related.map((item) => ({ name: item.name, imageUrl: item.picture_medium ?? null })),
  };
}

export async function fetchAlbum(id: string): Promise<AlbumDetail | null> {
  if (!/^\d+$/.test(id)) return null;

  // Strict: the caller turns null into notFound() on a force-static page, so a timeout must
  // not read as "no such album" and get cached as one. A body Deezer sent that is not an album
  // is the same kind of non-answer, and gets the same verdict rather than `notFound()`.
  const body = await deezerOrFail<unknown>(`/album/${id}`);
  if (body === null) return null;

  const parsed = albumDetailSchema.safeParse(body);
  if (!parsed.success) {
    throw new DeezerUnavailable(`/album/${id}`, "sent something that is not an album");
  }

  const album = parsed.data;
  const artist = album.artist?.name ?? "";
  const tracks = album.tracks ?? [];

  return {
    id: album.id,
    title: album.title,
    artist,
    kind: album.record_type ?? "album",
    year: album.release_date?.slice(0, 4) || null,
    coverUrl: album.cover_big ?? album.cover_medium ?? null,
    trackCount: album.nb_tracks ?? tracks.length,
    songs: tracks.map((track) => ({
      id: track.isrc ?? `deezer:${track.id}`,
      title: track.title,
      artists: [track.artist?.name || artist].filter(Boolean),
      album: album.title,
      durationMs: track.duration ? track.duration * 1000 : null,
      isrc: track.isrc ?? null,
      artworkUrl: album.cover_medium ?? null,
      sources: [
        {
          source: "deezer",
          sourceId: String(track.id),
          url: track.link ?? null,
          playback: "link" as const,
        },
      ],
    })),
  };
}

function nameScore(query: string, candidate: string): number {
  const a = normalizeLoose(query);
  const b = normalizeLoose(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (longer.includes(shorter)) return 0.6 + 0.35 * (shorter.length / longer.length);

  const wordsA = new Set(a.split(" "));
  const wordsB = new Set(b.split(" "));
  const shared = [...wordsA].filter((word) => wordsB.has(word)).length;
  return shared === 0 ? 0 : 0.55 * (shared / new Set([...wordsA, ...wordsB]).size);
}

export async function findArtist(name: string) {
  const query = name.trim();
  if (!query) return null;

  const results = await deezerListOrFail(
    `/search/artist?q=${encodeURIComponent(query)}&limit=25`,
    artistSchema,
  );
  if (results.length === 0) return null;

  const { artist: best } = results.reduce(
    (top, artist) => {
      const similarity = nameScore(query, artist.name);
      if (similarity === 0) return top;
      const reach = Math.min(1, Math.log10(1 + (artist.nb_fan ?? 0)) / 7);
      const score = similarity * similarity * (0.6 + 0.4 * reach);
      return score > top.score ? { artist, score } : top;
    },
    { artist: results[0]!, score: -1 },
  );

  return {
    name: best.name,
    imageUrl: best.picture_xl ?? best.picture_medium ?? null,
    followers: best.nb_fan ?? null,
    source: "deezer" as const,
    url: best.link ?? null,
  };
}
