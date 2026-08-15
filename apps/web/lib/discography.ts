import "server-only";

import { normalizeLoose } from "@timbre/core";

import { deezer } from "./deezer";

// An artist's releases, from Deezer, which publishes them keyless. No artist profile can
// be embedded: Spotify's needs an id from a paid API and YouTube Music has none.

export interface Release {
  id: number;
  title: string;
  /** Deezer's own tagging: `album`, `single`, `ep`, `compile`. */
  kind: string;
  year: string | null;
  coverUrl: string | null;
  trackCount: number | null;
}

export interface RelatedArtist {
  name: string;
  imageUrl: string | null;
}

interface DeezerAlbum {
  id: number;
  title: string;
  record_type?: string;
  release_date?: string;
  cover_medium?: string;
  nb_tracks?: number;
}

/** The numeric id, read out of the profile URL the artist lookup returned. */
export function deezerIdFrom(url: string | null | undefined): string | null {
  const match = url ? /deezer\.com\/(?:[a-z]{2}\/)?artist\/(\d+)/.exec(url) : null;
  return match ? match[1]! : null;
}

/** An artist's releases and neighbouring artists, from their Deezer profile URL. */
export async function fetchDiscography(
  artistUrl: string | null | undefined,
): Promise<{ releases: Release[]; related: RelatedArtist[] }> {
  const id = deezerIdFrom(artistUrl);
  if (!id) return { releases: [], related: [] };

  const [albums, related] = await Promise.all([
    deezer<{ data?: DeezerAlbum[] }>(`/artist/${id}/albums?limit=100`),
    deezer<{ data?: { name: string; picture_medium?: string }[] }>(
      `/artist/${id}/related?limit=12`,
    ),
  ]);

  // Deduplicated by title: a catalogue carries one record as deluxe, regional and
  // re-release editions, and after the sort the first sighting is the newest.
  const seen = new Set<string>();
  const releases = (albums?.data ?? [])
    .slice()
    .sort((a, b) => (b.release_date ?? "").localeCompare(a.release_date ?? ""))
    .filter((album) => {
      const key = album.title.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(
      (album): Release => ({
        id: album.id,
        title: album.title,
        kind: album.record_type ?? "album",
        year: album.release_date ? album.release_date.slice(0, 4) : null,
        coverUrl: album.cover_medium ?? null,
        trackCount: album.nb_tracks ?? null,
      }),
    );

  return {
    releases,
    related: (related?.data ?? []).map((item) => ({
      name: item.name,
      imageUrl: item.picture_medium ?? null,
    })),
  };
}

/** A track as Timbre's player understands it, carrying only Deezer identity. */
export interface AlbumSong {
  id: string;
  title: string;
  artists: string[];
  album: string | null;
  durationMs: number | null;
  isrc: string | null;
  artworkUrl: string | null;
  sources: { source: string; sourceId: string; url: string | null; playback: "link" }[];
}

export interface AlbumDetail {
  id: number;
  title: string;
  artist: string;
  kind: string;
  year: string | null;
  coverUrl: string | null;
  trackCount: number;
  songs: AlbumSong[];
}

interface DeezerTrack {
  id: number;
  title: string;
  duration?: number;
  isrc?: string;
  artist?: { name?: string };
  link?: string;
}

interface DeezerAlbumDetail {
  id: number;
  title: string;
  release_date?: string;
  cover_medium?: string;
  cover_big?: string;
  record_type?: string;
  nb_tracks?: number;
  artist?: { name?: string };
  tracks?: { data?: DeezerTrack[] };
}

/** One release and its tracks, by Deezer album id. */
export async function fetchAlbum(id: string): Promise<AlbumDetail | null> {
  if (!/^\d+$/.test(id)) return null;

  const album = await deezer<DeezerAlbumDetail>(`/album/${id}`);
  if (!album) return null;

  const artistName = album.artist?.name ?? "";
  const tracks = album.tracks?.data ?? [];

  return {
    id: album.id,
    title: album.title,
    artist: artistName,
    kind: album.record_type ?? "album",
    year: album.release_date ? album.release_date.slice(0, 4) : null,
    coverUrl: album.cover_big ?? album.cover_medium ?? null,
    trackCount: album.nb_tracks ?? tracks.length,
    songs: tracks.map((track) => ({
      // ISRC first, matching the merger, so this and a search hit are one entry.
      id: track.isrc ?? `deezer:${track.id}`,
      title: track.title,
      artists: [track.artist?.name || artistName].filter(Boolean),
      album: album.title,
      durationMs: track.duration ? track.duration * 1000 : null,
      isrc: track.isrc ?? null,
      artworkUrl: album.cover_medium ?? null,
      sources: [
        {
          source: "deezer",
          sourceId: String(track.id),
          url: track.link ?? null,
          // Identity only: Deezer audio needs a subscription, so the player resolves a
          // copy it can drive when a row is picked.
          playback: "link" as const,
        },
      ],
    })),
  };
}

export interface ResolvedArtist {
  name: string;
  imageUrl: string | null;
  followers: number | null;
  source: "deezer";
  url: string | null;
}

interface DeezerArtist {
  name: string;
  picture_medium?: string;
  picture_xl?: string;
  nb_fan?: number;
  link?: string;
}

/** How closely a candidate's name matches, 0 to 1: identical once normalised, one
 * containing the other scaled by length ratio, then shared words as a fraction. */
function nameScore(query: string, candidate: string): number {
  const a = normalizeLoose(query);
  const b = normalizeLoose(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (longer.includes(shorter)) {
    // A short query inside a long name is weak evidence — "so" is in "sonic youth".
    return 0.6 + 0.35 * (shorter.length / longer.length);
  }

  const wordsA = new Set(a.split(" "));
  const wordsB = new Set(b.split(" "));
  const shared = [...wordsA].filter((word) => wordsB.has(word)).length;
  if (shared === 0) return 0;
  return 0.55 * (shared / new Set([...wordsA, ...wordsB]).size);
}

/** Popularity, 0–1. Logarithmic because follower counts span six orders of
 * magnitude — linearly, everyone below a million rounds to zero. */
function reachScore(followers: number | undefined): number {
  return Math.min(1, Math.log10(1 + (followers ?? 0)) / 7);
}

/** Finds the artist a name most likely refers to. Deezer's own ordering is not enough:
 * `katseye` returns a three-follower "Katseye" before the 237,000-follower "KATSEYE", so the
 * top hit gave a page with the wrong picture and no discography. Squaring the similarity
 * means no amount of popularity can promote a wrong name. */
export async function findArtist(name: string): Promise<ResolvedArtist | null> {
  const query = name.trim();
  if (!query) return null;

  const found = await deezer<{ data?: DeezerArtist[] }>(
    `/search/artist?q=${encodeURIComponent(query)}&limit=25`,
  );
  const results = found?.data ?? [];
  if (results.length === 0) return null;

  let best = results[0]!;
  let bestScore = -1;

  for (const candidate of results) {
    const similarity = nameScore(query, candidate.name);
    if (similarity === 0) continue;
    // Similarity dominates; reach adjusts by at most 40%.
    const score = similarity * similarity * (0.6 + 0.4 * reachScore(candidate.nb_fan));
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return {
    name: best.name,
    imageUrl: best.picture_xl ?? best.picture_medium ?? null,
    followers: best.nb_fan ?? null,
    source: "deezer",
    url: best.link ?? null,
  };
}
