import "server-only";

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

async function deezer<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`https://api.deezer.com${path}`, {
      signal: AbortSignal.timeout(6_000),
      // Deezer's answers are stable for a long time and an artist page is the
      // kind of thing several people open at once.
      next: { revalidate: 86_400 },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as T & { error?: unknown };
    // Deezer answers 200 with an `error` object rather than a status code.
    return body && "error" in body && body.error ? null : body;
  } catch {
    // Unreachable or slow. A missing discography is not worth failing a page
    // whose songs are already on screen.
    return null;
  }
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
