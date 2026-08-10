import "server-only";

import { deezer } from "./deezer";

/**
 * What Explore is built from.
 *
 * Deezer publishes charts, genres and editorial keyless, which is the only
 * reason a page like this can exist in an app with no budget and no accounts.
 * Everything here is somebody else's ranking — Timbre plays none of it directly
 * and stores none of it, exactly as the artist pages work: picking a track
 * resolves a copy that can actually be driven.
 *
 * One request, not four. `/chart/{genre}` answers with tracks, albums and
 * artists together, so a genre switch costs a single round trip rather than
 * three racing ones that can half-fail and leave the page in a state no
 * combination of retries explains.
 */

/** A Deezer genre. `0` is the catalogue-wide chart, which Deezer calls "All". */
export interface Genre {
  id: number;
  name: string;
  imageUrl: string | null;
}

/**
 * A charting song.
 *
 * Deliberately the same shape `<SongCard>` already takes, plus the two fields
 * that make it a *chart* entry rather than a search result. Anything else and
 * the tile would need a second code path to render the same thing.
 */
export interface ChartTrack {
  id: string;
  title: string;
  artists: string[];
  album: string | null;
  durationMs: number | null;
  isrc: string | null;
  artworkUrl: string | null;
  sources: { source: string; sourceId: string; url: string | null; playback: "link" }[];
  /** Where it sits in this chart, 1-based. */
  position: number;
  /**
   * Deezer's own popularity score, 0–1,000,000.
   *
   * **Not a play count**, and labelled as a score everywhere it is shown. It is
   * the only continuous measure any free source publishes, and it is what makes
   * the difference between #1 and #10 visible instead of implied by the order.
   */
  popularity: number;
}

export interface ChartAlbum {
  id: number;
  title: string;
  artist: string;
  coverUrl: string | null;
  kind: string;
}

export interface ChartArtist {
  name: string;
  imageUrl: string | null;
}

/**
 * A Deezer playlist that is charting.
 *
 * These are the closest thing to Tidal's featured cards that exists without an
 * editorial team: real collections, with their own covers and track counts,
 * published keyless. Featuring one is not a claim Timbre is making — it is
 * showing what Deezer says people are listening to.
 */
export interface ChartPlaylist {
  id: number;
  title: string;
  by: string | null;
  coverUrl: string | null;
  trackCount: number | null;
  /**
   * A few of its own track covers.
   *
   * Deezer publishes a single picture per playlist, which makes a featured card
   * look like one record rather than like a collection. Its first few sleeves,
   * scattered, say "several things gathered" — which is what a playlist is, and
   * what Tidal's own collection cards show.
   */
  covers: string[];
}

export interface Discover {
  genre: number;
  genres: Genre[];
  tracks: ChartTrack[];
  albums: ChartAlbum[];
  artists: ChartArtist[];
  playlists: ChartPlaylist[];
}

interface RawTrack {
  id: number;
  title: string;
  duration?: number;
  rank?: number;
  position?: number;
  link?: string;
  artist?: { name?: string };
  album?: { title?: string; cover_medium?: string; cover_big?: string };
}

interface RawAlbum {
  id: number;
  title: string;
  record_type?: string;
  cover_medium?: string;
  artist?: { name?: string };
}

interface RawArtist {
  name: string;
  picture_medium?: string;
}

interface RawPlaylist {
  id: number;
  title: string;
  nb_tracks?: number;
  picture_medium?: string;
  picture_big?: string;
  user?: { name?: string };
  creator?: { name?: string };
}

interface RawChart {
  tracks?: { data?: RawTrack[] };
  albums?: { data?: RawAlbum[] };
  artists?: { data?: RawArtist[] };
  playlists?: { data?: RawPlaylist[] };
}

/**
 * Deezer's genre list, passed through as published.
 *
 * Not curated, and deliberately so. The list is locale-dependent — the
 * catalogue-wide chart is led by a German audio-drama series from here — so any
 * hand-picked subset would be right for one country and wrong for the next.
 * Whatever Deezer considers a genre is what Explore offers.
 */
function toGenre(raw: { id: number; name: string; picture_medium?: string }): Genre {
  return { id: raw.id, name: raw.name, imageUrl: raw.picture_medium ?? null };
}

function toTrack(raw: RawTrack, index: number): ChartTrack {
  return {
    // Namespaced so it cannot collide with a merged search result, which keys
    // on ISRC or on a source pair.
    id: `deezer:${raw.id}`,
    title: raw.title,
    artists: raw.artist?.name ? [raw.artist.name] : [],
    album: raw.album?.title ?? null,
    durationMs: raw.duration ? raw.duration * 1000 : null,
    isrc: null,
    artworkUrl: raw.album?.cover_big ?? raw.album?.cover_medium ?? null,
    sources: [
      {
        source: "deezer",
        sourceId: String(raw.id),
        url: raw.link ?? `https://www.deezer.com/track/${raw.id}`,
        // Timbre cannot play Deezer audio. Picking one searches for a copy it
        // can, which is the same path every chart entry already takes.
        playback: "link",
      },
    ],
    // `position` is absent from some genre charts; the array order is the
    // ranking either way, so the index is the honest fallback rather than a 0.
    position: raw.position ?? index + 1,
    popularity: raw.rank ?? 0,
  };
}

export async function fetchGenres(): Promise<Genre[]> {
  const data = await deezer<{ data?: { id: number; name: string; picture_medium?: string }[] }>(
    "/genre",
    // Genres change about once a decade.
    604_800,
  );
  return (data?.data ?? []).map(toGenre);
}

/**
 * A genre's chart, and the genre list beside it.
 *
 * Cached for an hour at the fetch layer: charts move daily at best, and this is
 * the page a visitor lands on, so the first request of the hour pays for
 * everyone else's.
 */
export async function fetchDiscover(genre: number): Promise<Discover> {
  const [genres, chart] = await Promise.all([
    fetchGenres(),
    deezer<RawChart>(`/chart/${genre}?limit=25`, 3_600),
  ]);

  return {
    genre,
    genres,
    tracks: (chart?.tracks?.data ?? []).map(toTrack),
    albums: (chart?.albums?.data ?? []).map((raw) => ({
      id: raw.id,
      title: raw.title,
      artist: raw.artist?.name ?? "",
      coverUrl: raw.cover_medium ?? null,
      kind: raw.record_type ?? "album",
    })),
    artists: (chart?.artists?.data ?? []).map((raw) => ({
      name: raw.name,
      imageUrl: raw.picture_medium ?? null,
    })),
    playlists: await withCovers((chart?.playlists?.data ?? []).slice(0, 6)),
  };
}

/**
 * Playlists, each carrying a few of its own sleeves.
 *
 * One extra request per playlist, capped at six and cached for a day, so the
 * whole featured row costs six calls an hour across every visitor. `limit=8`
 * rather than the whole tracklist: four distinct covers is all a collage shows,
 * and some playlists run two hundred tracks deep.
 *
 * A failure here costs the scatter and nothing else — the card falls back to
 * the published picture, which is what it used before this existed.
 */
async function withCovers(raw: RawPlaylist[]): Promise<ChartPlaylist[]> {
  return Promise.all(
    raw.map(async (playlist) => {
      const tracks = await deezer<{ data?: RawTrack[] }>(
        `/playlist/${playlist.id}/tracks?limit=8`,
        86_400,
      );

      const covers = new Set<string>();
      for (const track of tracks?.data ?? []) {
        const cover = track.album?.cover_medium ?? track.album?.cover_big;
        if (cover) covers.add(cover);
        if (covers.size === 5) break;
      }

      return {
        id: playlist.id,
        title: playlist.title,
        by: playlist.creator?.name ?? playlist.user?.name ?? null,
        coverUrl: playlist.picture_big ?? playlist.picture_medium ?? null,
        trackCount: playlist.nb_tracks ?? null,
        covers: [...covers],
      };
    }),
  );
}
