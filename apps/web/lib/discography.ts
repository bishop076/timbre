import "server-only";

import { normalizeLoose } from "@timbre/core";

import { deezer } from "./deezer";

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

interface DeezerAlbum {
  id: number;
  title: string;
  record_type?: string;
  release_date?: string;
  cover_medium?: string;
  nb_tracks?: number;
}

export function deezerIdFrom(url: string | null | undefined): string | null {
  const match = url ? /deezer\.com\/(?:[a-z]{2}\/)?artist\/(\d+)/.exec(url) : null;
  return match ? match[1]! : null;
}

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

function nameScore(query: string, candidate: string): number {
  const a = normalizeLoose(query);
  const b = normalizeLoose(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (longer.includes(shorter)) {
    return 0.6 + 0.35 * (shorter.length / longer.length);
  }

  const wordsA = new Set(a.split(" "));
  const wordsB = new Set(b.split(" "));
  const shared = [...wordsA].filter((word) => wordsB.has(word)).length;
  if (shared === 0) return 0;
  return 0.55 * (shared / new Set([...wordsA, ...wordsB]).size);
}

function reachScore(followers: number | undefined): number {
  return Math.min(1, Math.log10(1 + (followers ?? 0)) / 7);
}

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
