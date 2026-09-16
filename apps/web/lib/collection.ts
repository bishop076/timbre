import "server-only";

import {
  fetchSpotifyCollection,
  isYtMusicProvider,
  listProviders,
  type SpotifyCollectionKind,
} from "@timbre/providers";

import { cached } from "./api";
import { DeezerUnavailable, deezerOrFail, type RawTrack } from "./deezer";
import { coversOf, toTrackByOrder, type ChartTrack } from "./discover";
import { drawStation, drawStations, fetchFresh, type FeedProbe } from "./genre-feed";
import { listNames } from "./genre-tally";
import { getProviderRuntime } from "./providers";
import { genreOfStation } from "./radios";

export type CollectionKind =
  | "genre"
  | "playlist"
  | "mood"
  | "radio"
  | "spotify-album"
  | "spotify-playlist"
  | "ytmusic-playlist";

interface CollectionSection {
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

function sectioned(sections: CollectionSection[]): Pick<Collection, "sections" | "tracks" | "covers"> {
  const kept = sections.filter((section) => section.tracks.length > 0);
  const tracks = kept.flatMap((section) => section.tracks);
  return { sections: kept, tracks, covers: coversOf(tracks.map((track) => track.artworkUrl), 4) };
}

function unsectioned(tracks: ChartTrack[]) {
  return sectioned([{ key: "all", title: null, caption: null, tracks, ranked: false }]);
}

function newIn(genre: string | undefined, tracks: ChartTrack[]): CollectionSection {
  return {
    key: "new",
    title: `New in ${genre}`,
    caption: "Deezer editors' picks, newest release first",
    tracks,
    ranked: false,
  };
}

function without(tracks: ChartTrack[], taken: ChartTrack[]): ChartTrack[] {
  const ids = new Set(taken.map((track) => track.id));
  return tracks
    .filter((track) => !ids.has(track.id))
    .map((track, index) => ({ ...track, position: index + 1 }));
}

function joined(...parts: (string | null)[]): string {
  return parts.filter(Boolean).join(" · ");
}

/**
 * The strict list read, which is the only kind this file may use.
 *
 * `deezerList` forgives every outage into `[]`, and every caller below turns "nothing" into
 * `null`, which the page turns into `notFound()` — *"That collection has gone. Either the
 * address names a kind of collection Timbre does not serve, or the playlist, station or chart
 * behind it was taken down where it lived."* None of that is established by a request that
 * timed out, and the page is `force-static` with fifteen minutes of `revalidate`, so the
 * accusation was then served from the cache to everyone who asked. `/api/genre-feed` had
 * already reasoned this out for the same data — *"Deezer's genre list is a fixed catalogue, so
 * an empty one is never an answer"* — and the page it links to had not. Throwing reaches
 * `collection/[kind]/[id]/error.tsx`, which offers a retry and is not cached.
 */
async function listOrFail<T>(path: string, revalidateSeconds?: number): Promise<T[]> {
  return (await deezerOrFail<{ data?: T[] }>(path, revalidateSeconds))?.data ?? [];
}

/** Nothing came back and something had failed, so "there is nothing here" is not the answer. */
function nothingToShow(path: string): DeezerUnavailable {
  return new DeezerUnavailable(path, "could not fill this page");
}

async function fromPlaylist(id: string, kind: CollectionKind): Promise<Collection | null> {
  if (!/^\d+$/.test(id)) return null;

  const raw = await deezerOrFail<{
    title: string;
    nb_tracks?: number;
    picture_big?: string;
    creator?: { name?: string };
    tracks?: { data?: RawTrack[] };
  }>(`/playlist/${id}`);
  if (!raw?.title) return null;

  const tracks = (raw.tracks?.data ?? []).slice(0, 100).map(toTrackByOrder);
  const by = raw.creator?.name;

  return {
    kind,
    id,
    title: raw.title,
    subtitle: joined(`${raw.nb_tracks ?? tracks.length} songs`, by ? `by ${by}` : null, "on Deezer"),
    coverUrl: raw.picture_big ?? null,
    ...unsectioned(tracks),
    genreId: null,
    from: "Deezer",
  };
}

async function fromGenre(id: string): Promise<Collection | null> {
  if (!/^\d+$/.test(id)) return null;
  const genre = Number(id);
  const overall = genre === 0;
  const probe: FeedProbe = { failed: false };

  const [chartBody, genres, fresh, drawn] = await Promise.all([
    deezerOrFail<{ tracks?: { data?: RawTrack[] } }>(`/chart/${id}?limit=50`, 3_600),
    listOrFail<{ id: number; name: string }>("/genre", 604_800),
    overall ? [] : fetchFresh(genre, probe),
    overall ? { stations: [], tracks: [] } : drawStations(genre, probe),
  ]);
  const charted = chartBody?.tracks?.data ?? [];

  const name = genres.find((entry) => entry.id === genre)?.name;
  if (!overall && name === undefined) return null;

  const chart = charted.map(toTrackByOrder);
  const newest = without(fresh, chart);
  const onAir = without(drawn.tracks, [...chart, ...newest]).slice(0, 30);
  const stations = drawn.stations.map((station) => station.title);

  const shelf = sectioned([
    newIn(name, newest),
    {
      key: "stations",
      title: `On ${name} stations now`,
      caption: stations.length ? `From ${listNames(stations)} — a new draw every 15 minutes` : null,
      tracks: onAir,
      ranked: false,
    },
    {
      key: "chart",
      title: overall ? null : `${name} chart`,
      caption: overall ? null : "Deezer's chart for the genre — it leans on whatever is big overall",
      tracks: chart,
      ranked: true,
    },
  ]);
  if (shelf.tracks.length === 0) {
    if (probe.failed) throw nothingToShow(`/genre/${id}`);
    return null;
  }

  const fresher = newest.length + onAir.length;

  return {
    kind: "genre",
    id,
    title: overall ? "Top songs this week" : `${name} right now`,
    subtitle: overall
      ? `${chart.length} songs · Deezer chart`
      : joined(
          fresher ? `${fresher} fresh` : null,
          chart.length ? `${chart.length} charting` : null,
          "Deezer",
        ),
    coverUrl: null,
    ...shelf,
    genreId: overall ? null : genre,
    from: "Deezer",
  };
}

/**
 * Which of Deezer's answers a mood actually wants.
 *
 * Deezer ranks `/search/playlist` by relevance and this used to throw that ranking away
 * wholesale, taking whichever result was longest. Length is not relevance, and on live data it
 * was not even close: `/collection/mood/sleep` served "Berceuses 2.0 Pour Endormir Bébé" — 473
 * tracks of French lullabies for babies — over the editorial "Sleep Sequence"; `focus` served
 * "Calm Piano" over "Focus"; `party` served "Afro House" over "Party Hits".
 *
 * Length was only ever standing in for "not a stub", so that is all it decides now: take the
 * first playlist Deezer ranked that is long enough to be a mood, and fall back to its longest
 * answer only when none of them is.
 */
const MOOD_MINIMUM_TRACKS = 15;

export function pickMoodPlaylist<T extends { nb_tracks?: number }>(
  candidates: readonly T[],
): T | undefined {
  return (
    candidates.find((entry) => (entry.nb_tracks ?? 0) >= MOOD_MINIMUM_TRACKS) ??
    candidates.toSorted((a, b) => (b.nb_tracks ?? 0) - (a.nb_tracks ?? 0))[0]
  );
}

async function fromMood(term: string): Promise<Collection | null> {
  const found = await listOrFail<{ id: number; nb_tracks?: number }>(
    `/search/playlist?q=${encodeURIComponent(term)}&limit=10`,
  );
  const best = pickMoodPlaylist(found);
  if (!best) return null;

  const collection = await fromPlaylist(String(best.id), "mood");
  if (!collection) return null;

  return {
    ...collection,
    id: term,
    title: term
      .split(/[-\s]+/)
      .filter(Boolean)
      .map((word) => (/^\d/.test(word) ? word : word[0]!.toUpperCase() + word.slice(1)))
      .join(" "),
    subtitle: `${collection.title} · ${collection.subtitle}`,
  };
}

async function fromRadio(id: string): Promise<Collection | null> {
  if (!/^\d+$/.test(id)) return null;

  const probe: FeedProbe = { failed: false };
  const [meta, onAir, genre] = await Promise.all([
    deezerOrFail<{ title?: string; picture_big?: string }>(`/radio/${id}`),
    drawStation(Number(id), probe),
    genreOfStation(Number(id)),
  ]);
  if (onAir.length === 0) {
    if (probe.failed) throw nothingToShow(`/radio/${id}`);
    return null;
  }

  const fresh = genre ? without(await fetchFresh(genre.id, probe), onAir) : [];

  return {
    kind: "radio",
    id,
    title: meta?.title ?? "Radio",
    subtitle: joined(
      `${onAir.length} songs on air`,
      fresh.length ? `${fresh.length} new` : null,
      "Deezer radio",
    ),
    coverUrl: meta?.picture_big ?? null,
    ...sectioned([
      {
        key: "on-air",
        title: fresh.length ? "On air now" : null,
        caption: fresh.length ? "A new draw every 15 minutes" : null,
        tracks: onAir,
        ranked: false,
      },
      newIn(genre?.name, fresh),
    ]),
    genreId: genre?.id ?? null,
    from: "Deezer",
  };
}

async function fromSpotify(kind: SpotifyCollectionKind, id: string): Promise<Collection | null> {
  // No catch, for the reason `fromYouTube` has none. This one was the last of the swallowed
  // failures: `fetchSpotifyCollection` already falls back from the pathfinder to the embed page
  // and answers `null` only when Spotify says there is no such thing, so the blanket `.catch`
  // here caught exactly the cases that are not that — a timeout, a refused token bootstrap, the
  // embed host unreachable. Measured with Spotify unreachable, a real album id came back `null`
  // after two failed requests, which this page is `force-static` about: `notFound()`, cached as
  // the answer for fifteen minutes. A throw reaches `error.tsx` instead, and is not cached.
  const found = await fetchSpotifyCollection(getProviderRuntime(), kind, id);
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
    kind: `spotify-${kind}`,
    id,
    title: found.title,
    subtitle: joined(found.by ? `by ${found.by}` : null, found.year, count, "on Spotify"),
    coverUrl: found.coverUrl,
    ...unsectioned(tracks),
    genreId: null,
    from: "Spotify",
  };
}

async function fromYouTube(id: string): Promise<Collection | null> {
  const runtime = getProviderRuntime();
  const provider = listProviders().find(isYtMusicProvider);
  if (!provider) return null;

  // No catch: `playlist` softens a real 404 to null and throws for anything else, which is
  // the distinction this page needs. Swallowing it cached "no such playlist" for a sidecar
  // that was merely down.
  const found = await cached(`ytmusic-playlist:${id}`, () => provider.playlist(runtime, id, 100));
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
    subtitle: joined(by ? `by ${by}` : null, found.year, count, "on YouTube Music"),
    coverUrl: found.artworkUrl,
    ...unsectioned(tracks),
    genreId: null,
    from: "YouTube Music",
  };
}

export async function fetchCollection(kind: CollectionKind, id: string): Promise<Collection | null> {
  if (kind === "genre") return fromGenre(id);
  if (kind === "playlist") return fromPlaylist(id, "playlist");
  if (kind === "radio") return fromRadio(id);
  if (kind === "spotify-album") return fromSpotify("album", id);
  if (kind === "spotify-playlist") return fromSpotify("playlist", id);
  if (kind === "ytmusic-playlist") return fromYouTube(id);
  return fromMood(id);
}
