import "server-only";

import {
  fetchSpotifyCollection,
  isYtMusicProvider,
  listProviders,
  type SpotifyCollectionKind,
  type YtMusicPlaylist,
} from "@timbre/providers";

import { cached } from "./api";
import { deezer } from "./deezer";
import { coversOf, toTrackByOrder, type ChartTrack, type RawTrack } from "./discover";
import { drawStation, drawStations, fetchFresh, genreOfStation } from "./genre-feed";
import { listNames } from "./genre-tally";
import { getProviderRuntime } from "./providers";

export type CollectionKind =
  | "genre"
  | "playlist"
  | "mood"
  | "radio"
  | "spotify-album"
  | "spotify-playlist"
  | "ytmusic-playlist";

export interface CollectionSection {
  key: string;
  title: string | null;
  caption: string | null;
  tracks: ChartTrack[];
  ranked: boolean;
}

export interface Collection {
  kind: CollectionKind;
  id: string;
  title: string;
  subtitle: string;
  covers: string[];
  coverUrl: string | null;
  tracks: ChartTrack[];
  sections: CollectionSection[];
  genreId: number | null;
  from: "Deezer" | "Spotify" | "YouTube Music";
}

function tiles(tracks: ChartTrack[]): string[] {
  return coversOf(
    tracks.map((track) => track.artworkUrl),
    4,
  );
}

function single(tracks: ChartTrack[]): CollectionSection[] {
  return [{ key: "all", title: null, caption: null, tracks, ranked: false }];
}

function assemble(sections: CollectionSection[]): { sections: CollectionSection[]; tracks: ChartTrack[] } {
  const kept = sections.filter((section) => section.tracks.length > 0);
  return { sections: kept, tracks: kept.flatMap((section) => section.tracks) };
}

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

async function fromGenre(id: string): Promise<Collection | null> {
  if (!/^\d+$/.test(id)) return null;
  const genre = Number(id);

  const [chartRaw, genres, fresh, drawn] = await Promise.all([
    deezer<{ tracks?: { data?: RawTrack[] } }>(`/chart/${id}?limit=50`, 3_600),
    deezer<{ data?: { id: number; name: string }[] }>("/genre", 604_800),
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
    covers: tiles(tracks),
    coverUrl: null,
    tracks,
    sections,
    genreId: genre === 0 ? null : genre,
    from: "Deezer",
  };
}

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

async function fromSpotify(kind: SpotifyCollectionKind, id: string): Promise<Collection | null> {
  const { limiter } = getProviderRuntime();
  const found = await fetchSpotifyCollection({ limiter }, kind, id).catch(() => null);
  if (!found || found.tracks.length === 0) return null;

  const tracks: ChartTrack[] = found.tracks.map((track, index) => ({
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

  const count =
    found.total > tracks.length ? `${tracks.length} of ${found.total} songs` : `${tracks.length} songs`;

  return {
    kind: kind === "album" ? "spotify-album" : "spotify-playlist",
    id,
    title: found.title,
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

async function fromYouTube(id: string): Promise<Collection | null> {
  const { limiter } = getProviderRuntime();
  const provider = listProviders().find(isYtMusicProvider);
  if (!provider) return null;

  const found = await cached<YtMusicPlaylist | null>(`ytmusic-playlist:${id}`, () =>
    provider.playlist({ limiter }, id, 100),
  ).catch(() => null);
  if (!found) return null;

  const seen = new Set<string>();
  const tracks: ChartTrack[] = [];
  for (const track of found.tracks) {
    if (seen.has(track.sourceId)) continue;
    seen.add(track.sourceId);
    tracks.push({
      id: `ytmusic:${track.sourceId}`,
      title: track.title,
      artists: track.artists,
      album: track.album,
      durationMs: track.durationMs,
      isrc: null,
      artworkUrl: track.artworkUrl,
      sources: [{ source: "ytmusic", sourceId: track.sourceId, url: track.url, playback: "queue" }],
      position: tracks.length + 1,
      popularity: 0,
    });
  }
  if (tracks.length === 0) return null;

  const album = id.startsWith("OLAK5uy_");
  const by = found.author ?? (album ? (tracks[0]?.artists[0] ?? null) : null);
  const count =
    found.trackCount !== null && found.trackCount > tracks.length
      ? `${tracks.length} of ${found.trackCount} songs`
      : `${tracks.length} songs`;

  return {
    kind: "ytmusic-playlist",
    id,
    title: found.title,
    subtitle: [by ? `by ${by}` : null, found.year, count, "on YouTube Music"].filter(Boolean).join(" · "),
    covers: tiles(tracks),
    coverUrl: found.artworkUrl,
    tracks,
    sections: single(tracks),
    genreId: null,
    from: "YouTube Music",
  };
}

export async function fetchCollection(
  kind: CollectionKind,
  id: string,
): Promise<Collection | null> {
  if (kind === "genre") return fromGenre(id);
  if (kind === "playlist") return fromPlaylist(id, "playlist");
  if (kind === "radio") return fromRadio(id);
  if (kind === "spotify-album") return fromSpotify("album", id);
  if (kind === "spotify-playlist") return fromSpotify("playlist", id);
  if (kind === "ytmusic-playlist") return fromYouTube(id);
  return fromMood(id);
}
