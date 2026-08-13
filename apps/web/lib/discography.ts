import "server-only";

import { normalizeLoose } from "@timbre/core";

import { deezer } from "./deezer";

/**
 * An artist's releases, from Deezer.
 *
 * **There is no way to embed somebody else's artist profile.** Spotify does
 * publish an artist embed, but reaching it needs an id from an API that now
 * requires a paid developer account, and the free service that used to map a
 * song onto its Spotify equivalent shut down in July 2026. YouTube Music has no
 * artist embed at all. So a discography cannot be borrowed whole — it has to be
 * assembled, which is the same trade the rest of Timbre makes.
 *
 * Deezer publishes all of it keyless: releases tagged by kind, with dates and
 * covers, plus neighbouring artists. Playback is somebody else's problem, as
 * always — picking a track resolves a copy Timbre can actually drive.
 *
 * Shared by the artist page and `/api/artist`, so the shaping rules live in one
 * place rather than being written twice and drifting.
 */

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

  /*
   * Newest first, then deduplicated by title.
   *
   * A catalogue routinely carries one record several times — a deluxe edition,
   * a regional master, a re-release — and a discography listing the same album
   * four times reads as broken rather than complete. The first sighting wins,
   * which after the sort is the most recent.
   */
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

// ---------------------------------------------------------------------------
// One release
// ---------------------------------------------------------------------------

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
      // ISRC first, matching the merger's own identity rule, so a song saved
      // from here and the same song saved from search are one entry.
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
          // Identity only. Deezer audio needs a subscription, so the player
          // resolves a copy it can drive when a row is picked.
          playback: "link" as const,
        },
      ],
    })),
  };
}

// ---------------------------------------------------------------------------
// Which artist did they mean
// ---------------------------------------------------------------------------

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

/**
 * How closely a candidate's name matches what was asked for, 0 to 1.
 *
 * Three tiers, cheapest first, all computed from the strings themselves — there
 * is no list of special cases anywhere in this file, and adding one would only
 * fix the artist somebody happened to complain about.
 *
 * - **Identical** once normalised. Case, punctuation and accents cannot
 *   separate "KATSEYE" from "katseye".
 * - **One contains the other**, scaled by how much of the longer string the
 *   shorter accounts for. Catalogues routinely append a native-script name or
 *   a disambiguator, and "x (y)" is still the artist called "x".
 * - **Shared words**, as a fraction of all distinct words across both. Catches
 *   a missing "the" or a reordering without rewarding two names that merely
 *   share a letter.
 */
function nameScore(query: string, candidate: string): number {
  const a = normalizeLoose(query);
  const b = normalizeLoose(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (longer.includes(shorter)) {
    // A short query inside a long name is weak evidence — "so" is inside
    // "sonic youth" — so the ratio does the discounting rather than a rule.
    return 0.6 + 0.35 * (shorter.length / longer.length);
  }

  const wordsA = new Set(a.split(" "));
  const wordsB = new Set(b.split(" "));
  const shared = [...wordsA].filter((word) => wordsB.has(word)).length;
  if (shared === 0) return 0;
  return 0.55 * (shared / new Set([...wordsA, ...wordsB]).size);
}

/**
 * Popularity, compressed to 0–1.
 *
 * Logarithmic because follower counts span six orders of magnitude: linearly,
 * every artist below a million rounds to zero and the scale stops
 * distinguishing anything.
 */
function reachScore(followers: number | undefined): number {
  return Math.min(1, Math.log10(1 + (followers ?? 0)) / 7);
}

/**
 * Finds the artist a name most likely refers to.
 *
 * Deezer's own ordering is not enough on its own. Searching `katseye` returns a
 * three-follower act called "Katseye" **before** the 237,000-follower
 * "KATSEYE", so taking the top hit produced a page with the wrong picture, no
 * discography and a follower count of 3 — while the songs below it, which come
 * from YouTube Music, were right. That reads as Timbre being broken rather than
 * as a mismatch.
 *
 * So candidates are **scored**, not filtered: name similarity decides who is
 * plausible, and reach only ever separates names that are already comparably
 * close. Squaring the similarity is what enforces that — it widens the gap
 * between a good and a mediocre name match far faster than reach can close it,
 * so no amount of popularity promotes a wrong name. Katy Perry has forty times
 * the following of KATSEYE and still loses the query `katseye`, because her
 * name scores zero against it.
 *
 * Nothing here knows any artist. Give it a different catalogue or a different
 * name and the same arithmetic applies.
 */
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
    // Similarity dominates; reach adjusts by at most 40% within a tier.
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
