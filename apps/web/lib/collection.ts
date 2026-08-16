import "server-only";

import { deezer } from "./deezer";
import { coversOf, toTrackByOrder, type ChartTrack, type RawTrack } from "./discover";

/*
 * A collection: songs gathered under one name — a genre chart, a Deezer playlist, or a
 * mood resolved to one. All kinds resolve to the same shape, so the page rendering them
 * never knows which it has and there is no second layout.
 */

export type CollectionKind = "genre" | "playlist" | "mood" | "radio";

export interface Collection {
  kind: CollectionKind;
  id: string;
  title: string;
  /** What it is, in a few words: "Deezer chart", "48 songs · Deezer". */
  subtitle: string;
  /** Up to four covers, tiled when the collection was assembled rather than published. */
  covers: string[];
  coverUrl: string | null;
  tracks: ChartTrack[];
}

/** Four covers, tiled. */
function tiles(tracks: ChartTrack[]): string[] {
  return coversOf(
    tracks.map((track) => track.artworkUrl),
    4,
  );
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
  };
}

/** A genre's chart. The name is looked up, never taken from the URL, so the heading can't be dictated. */
async function fromGenre(id: string): Promise<Collection | null> {
  const [chart, genres] = await Promise.all([
    deezer<{ tracks?: { data?: RawTrack[] } }>(`/chart/${id}?limit=50`, 3_600),
    deezer<{ data?: { id: number; name: string }[] }>("/genre", 604_800),
  ]);

  const tracks = (chart?.tracks?.data ?? []).map(toTrackByOrder);
  if (tracks.length === 0) return null;

  // The id must name a genre Deezer publishes: `/chart/{id}` does not validate its path
  // segment, and a non-numeric id returns the *global* chart, so `/genre/abc` served the
  // worldwide top songs under a made-up heading. Never fall back to a placeholder.
  const name = genres?.data?.find((entry) => String(entry.id) === id)?.name;
  if (id !== "0" && name === undefined) return null;

  const title = id === "0" ? "Top songs this week" : `${name} right now`;

  return {
    kind: "genre",
    id,
    title,
    subtitle: `${tracks.length} songs · Deezer chart`,
    covers: tiles(tracks),
    coverUrl: null,
    tracks,
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

/** A Deezer radio's own tracks. Title from Deezer, never from the URL. */
async function fromRadio(id: string): Promise<Collection | null> {
  const [meta, list] = await Promise.all([
    deezer<{ title?: string; picture_big?: string }>(`/radio/${id}`, 86_400),
    deezer<{ data?: RawTrack[] }>(`/radio/${id}/tracks`, 3_600),
  ]);

  const tracks = (list?.data ?? []).slice(0, 100).map(toTrackByOrder);
  if (tracks.length === 0) return null;

  return {
    kind: "radio",
    id,
    title: meta?.title ?? "Radio",
    subtitle: `${tracks.length} songs · Deezer radio`,
    covers: tiles(tracks),
    coverUrl: meta?.picture_big ?? null,
    tracks,
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
  return fromMood(id);
}
