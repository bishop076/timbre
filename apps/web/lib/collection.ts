import "server-only";

import { fetchSpotifyCollection, type SpotifyCollectionKind } from "@timbre/providers";

import { deezer } from "./deezer";
import { coversOf, toTrackByOrder, type ChartTrack, type RawTrack } from "./discover";
import { drawStation, drawStations, fetchFresh, genreOfStation } from "./genre-feed";
import { listNames } from "./genre-tally";
import { getProviderRuntime } from "./providers";

/*
 * A collection: songs gathered under one name — a genre, a Deezer playlist, a station, a mood
 * resolved to one, or a Spotify album or playlist someone pasted. All kinds resolve to the same
 * shape, so the page rendering them never knows which it has and there is no second layout.
 */

export type CollectionKind = "genre" | "playlist" | "mood" | "radio" | "spotify-album" | "spotify-playlist";

/** A named run of a collection's songs. A playlist is one untitled section; a genre is three. */
export interface CollectionSection {
  key: string;
  /** Null for a collection that is one list — a heading repeating the page's reads as a bug. */
  title: string | null;
  caption: string | null;
  tracks: ChartTrack[];
  /** A chart, whose order is a ranking: numbered, and compared against the last visit. */
  ranked: boolean;
}

export interface Collection {
  kind: CollectionKind;
  id: string;
  title: string;
  /** What it is, in a few words: "Deezer chart", "48 songs · Deezer". */
  subtitle: string;
  /** Up to four covers, tiled when the collection was assembled rather than published. */
  covers: string[];
  coverUrl: string | null;
  /** Every section's songs, in page order — what Play and Shuffle take. */
  tracks: ChartTrack[];
  sections: CollectionSection[];
  /** The Deezer genre it belongs to, so the page can add what *you* played in it. */
  genreId: number | null;
  /** The catalogue it was assembled from, named on the page. */
  from: "Deezer" | "Spotify";
}

/** Four covers, tiled. */
function tiles(tracks: ChartTrack[]): string[] {
  return coversOf(
    tracks.map((track) => track.artworkUrl),
    4,
  );
}

/** One untitled section: a playlist's order is its own and carries no heading. */
function single(tracks: ChartTrack[]): CollectionSection[] {
  return [{ key: "all", title: null, caption: null, tracks, ranked: false }];
}

/** Sections with nothing in them dropped, and the rest flattened for Play. */
function assemble(sections: CollectionSection[]): { sections: CollectionSection[]; tracks: ChartTrack[] } {
  const kept = sections.filter((section) => section.tracks.length > 0);
  return { sections: kept, tracks: kept.flatMap((section) => section.tracks) };
}

/** `tracks` without anything already in `taken`, renumbered — a fresh list that repeats the chart below it is no fresher. */
function without(tracks: ChartTrack[], taken: ChartTrack[]): ChartTrack[] {
  const ids = new Set(taken.map((track) => track.id));
  return tracks
    .filter((track) => !ids.has(track.id))
    .map((track, index) => ({ ...track, position: index + 1 }));
}

async function fromPlaylist(id: string, kind: CollectionKind): Promise<Collection | null> {
  const raw = await deezer<{
    id: number;
    title: string;
    nb_tracks?: number;
    picture_big?: string;
    creator?: { name?: string };
    tracks?: { data?: RawTrack[] };
  }>(`/playlist/${id}`, 86_400);
  if (!raw?.title) return null;

  // Capped at 100: some playlists run two hundred deep, and every row costs an image.
  const tracks = (raw.tracks?.data ?? []).slice(0, 100).map(toTrackByOrder);
  const by = raw.creator?.name;

  return {
    kind,
    id,
    title: raw.title,
    subtitle: [`${raw.nb_tracks ?? tracks.length} songs`, by ? `by ${by}` : null, "on Deezer"]
      .filter(Boolean)
      .join(" · "),
    covers: tiles(tracks),
    coverUrl: raw.picture_big ?? null,
    tracks,
    sections: single(tracks),
    genreId: null,
    from: "Deezer",
  };
}

/**
 * A genre: what is new in it, what its stations are playing, then its chart. The chart
 * alone was the whole page and moves weekly, and is only loosely the genre — see
 * `genre-feed.ts`. The name is looked up, never taken from the URL, so the heading can't be
 * dictated.
 */
async function fromGenre(id: string): Promise<Collection | null> {
  // The id must name a genre Deezer publishes: `/chart/{id}` does not validate its path
  // segment, and a non-numeric id returns the *global* chart, so `/genre/abc` served the
  // worldwide top songs under a made-up heading. Never fall back to a placeholder.
  if (!/^\d+$/.test(id)) return null;
  const genre = Number(id);

  const [chartRaw, genres, fresh, drawn] = await Promise.all([
    deezer<{ tracks?: { data?: RawTrack[] } }>(`/chart/${id}?limit=50`, 3_600),
    deezer<{ data?: { id: number; name: string }[] }>("/genre", 604_800),
    // The catalogue-wide chart is already the "Top songs this week" card; the rest is a genre's.
    genre === 0 ? Promise.resolve([]) : fetchFresh(genre),
    genre === 0 ? Promise.resolve({ stations: [], tracks: [] }) : drawStations(genre),
  ]);

  const name = genres?.data?.find((entry) => entry.id === genre)?.name;
  if (genre !== 0 && name === undefined) return null;

  const chart = (chartRaw?.tracks?.data ?? []).map(toTrackByOrder);
  const newest = without(fresh, chart);
  const onAir = without(drawn.tracks, [...chart, ...newest]).slice(0, 30);

  const { sections, tracks } = assemble([
    {
      key: "new",
      title: `New in ${name}`,
      caption: "Deezer editors' picks, newest release first",
      tracks: newest,
      ranked: false,
    },
    {
      key: "stations",
      title: `On ${name} stations now`,
      caption: drawn.stations.length
        ? `From ${listNames(drawn.stations.map((station) => station.title))} — a new draw every 15 minutes`
        : null,
      tracks: onAir,
      ranked: false,
    },
    {
      key: "chart",
      // A single section needs no heading: it is the page.
      title: genre === 0 ? null : `${name} chart`,
      caption: genre === 0 ? null : "Deezer's chart for the genre — it leans on whatever is big overall",
      tracks: chart,
      ranked: true,
    },
  ]);
  if (tracks.length === 0) return null;

  const title = genre === 0 ? "Top songs this week" : `${name} right now`;
  const fresher = newest.length + onAir.length;

  return {
    kind: "genre",
    id,
    title,
    subtitle:
      genre === 0
        ? `${chart.length} songs · Deezer chart`
        : [fresher ? `${fresher} fresh` : null, chart.length ? `${chart.length} charting` : null, "Deezer"]
            .filter(Boolean)
            .join(" · "),
    // From the fresh sections first: tiled from the chart, every genre wore the same four faces.
    covers: tiles(tracks),
    coverUrl: null,
    tracks,
    sections,
    genreId: genre === 0 ? null : genre,
    from: "Deezer",
  };
}

/** A mood or decade resolved to a playlist. Nothing is stored; most tracks wins, as a proxy for "maintained". */
async function fromMood(term: string): Promise<Collection | null> {
  const found = await deezer<{ data?: { id: number; nb_tracks?: number }[] }>(
    `/search/playlist?q=${encodeURIComponent(term)}&limit=10`,
    86_400,
  );

  const best = (found?.data ?? [])
    .slice()
    .sort((a, b) => (b.nb_tracks ?? 0) - (a.nb_tracks ?? 0))[0];
  if (!best) return null;

  const collection = await fromPlaylist(String(best.id), "mood");
  if (!collection) return null;

  // The pill's word heads the page: landing on "Classical sleep" alone reads as broken.
  return {
    ...collection,
    id: term,
    title: label(term),
    subtitle: `${collection.title} · ${collection.subtitle}`,
  };
}

function label(term: string): string {
  return term
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((word) => (/^\d/.test(word) ? word : word[0]!.toUpperCase() + word.slice(1)))
    .join(" ");
}

/**
 * A Deezer station's current draw, then what is new in its genre. Title from Deezer, never
 * from the URL. The draw is cached for a quarter of an hour rather than an hour: Deezer deals
 * a different hand on every call, and holding one for an hour made a station a playlist.
 */
async function fromRadio(id: string): Promise<Collection | null> {
  if (!/^\d+$/.test(id)) return null;

  const [meta, onAir, genre] = await Promise.all([
    deezer<{ title?: string; picture_big?: string }>(`/radio/${id}`, 86_400),
    drawStation(Number(id)),
    genreOfStation(Number(id)),
  ]);
  if (onAir.length === 0) return null;

  const fresh = genre ? without(await fetchFresh(genre.id), onAir) : [];

  const { sections, tracks } = assemble([
    {
      key: "on-air",
      title: fresh.length ? "On air now" : null,
      caption: fresh.length ? "A new draw every 15 minutes" : null,
      tracks: onAir,
      ranked: false,
    },
    {
      key: "new",
      title: genre ? `New in ${genre.name}` : null,
      caption: "Deezer editors' picks, newest release first",
      tracks: fresh,
      ranked: false,
    },
  ]);

  return {
    kind: "radio",
    id,
    title: meta?.title ?? "Radio",
    subtitle: [`${onAir.length} songs on air`, fresh.length ? `${fresh.length} new` : null, "Deezer radio"]
      .filter(Boolean)
      .join(" · "),
    covers: tiles(tracks),
    coverUrl: meta?.picture_big ?? null,
    tracks,
    sections,
    genreId: genre?.id ?? null,
    from: "Deezer",
  };
}

/**
 * A Spotify album or playlist, read anonymously — see `packages/providers/src/spotify-web.ts`.
 * Reached by pasting its link. Each track keeps its Spotify identity, so the player looks for
 * a full copy it can queue first and falls back to Spotify's own embed, exactly as it does for
 * a pasted Spotify track. A refusal from Spotify reads as "not found" rather than a 500: the
 * surface is private and will break, and a page that says so beats one that crashes.
 */
async function fromSpotify(kind: SpotifyCollectionKind, id: string): Promise<Collection | null> {
  const { limiter } = getProviderRuntime();
  const found = await fetchSpotifyCollection({ limiter }, kind, id).catch(() => null);
  if (!found || found.tracks.length === 0) return null;

  const tracks: ChartTrack[] = found.tracks.map((track, index) => ({
    // Namespaced like every other Spotify id in the app, so none can meet a merged song's.
    id: `spotify:${track.sourceId}`,
    title: track.title,
    artists: track.artists,
    album: track.album,
    durationMs: track.durationMs,
    isrc: track.isrc,
    artworkUrl: track.artworkUrl,
    sources: [{ source: "spotify", sourceId: track.sourceId, url: track.url, playback: "manual" }],
    position: index + 1,
    popularity: 0,
  }));

  // Said when Spotify has more than one page's worth, or "100 songs" undersells a 300-song list.
  const count =
    found.total > tracks.length ? `${tracks.length} of ${found.total} songs` : `${tracks.length} songs`;

  return {
    kind: kind === "album" ? "spotify-album" : "spotify-playlist",
    id,
    title: found.title,
    // The Deezer playlist's wording. The kind is already the eyebrow above the title.
    subtitle: [found.by ? `by ${found.by}` : null, found.year, count, "on Spotify"]
      .filter(Boolean)
      .join(" · "),
    covers: tiles(tracks),
    coverUrl: found.coverUrl,
    tracks,
    sections: single(tracks),
    genreId: null,
    from: "Spotify",
  };
}

/** One collection by kind and id, or null when it cannot be established. */
export async function fetchCollection(
  kind: CollectionKind,
  id: string,
): Promise<Collection | null> {
  if (kind === "genre") return fromGenre(id);
  if (kind === "playlist") return fromPlaylist(id, "playlist");
  if (kind === "radio") return fromRadio(id);
  if (kind === "spotify-album") return fromSpotify("album", id);
  if (kind === "spotify-playlist") return fromSpotify("playlist", id);
  return fromMood(id);
}
