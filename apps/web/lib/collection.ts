import "server-only";

import { deezer } from "./deezer";
import type { ChartTrack } from "./discover";

/**
 * A collection: several songs, gathered into one thing with a name.
 *
 * Explore is a page of cards, and a card has to *lead* somewhere — otherwise it
 * is a picture of a chart position and the page is a list of the same songs in
 * three different shapes. Every card here opens one of these instead: a genre's
 * chart, a Deezer playlist, or a mood resolved to one. One route, one page, one
 * cover, one queue you can play end to end.
 *
 * All three kinds resolve to the same shape deliberately. The page that renders
 * them has no idea which it is showing, so a mood behaves exactly like a
 * playlist and a genre chart behaves like both — there is no third layout to
 * keep in step.
 */

export type CollectionKind = "genre" | "playlist" | "mood" | "radio";

export interface Collection {
  kind: CollectionKind;
  id: string;
  title: string;
  /** What it is, in a few words: "Deezer chart", "48 songs · Deezer". */
  subtitle: string;
  /**
   * Up to four covers.
   *
   * A collection has no artwork of its own when it is assembled rather than
   * published — a genre chart is not a record and nobody drew a sleeve for it.
   * Four of its own covers tiled together is the honest picture: it is made of
   * these, and it says so.
   */
  covers: string[];
  /** A published cover, when the collection came with one. */
  coverUrl: string | null;
  tracks: ChartTrack[];
}

interface RawTrack {
  id: number;
  title: string;
  duration?: number;
  rank?: number;
  link?: string;
  artist?: { name?: string };
  album?: { title?: string; cover_medium?: string; cover_big?: string };
}

/**
 * The same mapping `discover.ts` uses, kept here rather than exported across
 * because the two differ in one way that matters: a playlist has no chart
 * position, so `position` is the index and nothing pretends otherwise.
 */
function toTrack(raw: RawTrack, index: number): ChartTrack {
  return {
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
        playback: "link",
      },
    ],
    position: index + 1,
    popularity: raw.rank ?? 0,
  };
}

/** The first four distinct covers, for the tile. */
function coversOf(tracks: ChartTrack[]): string[] {
  const seen = new Set<string>();
  for (const track of tracks) {
    if (track.artworkUrl) seen.add(track.artworkUrl);
    if (seen.size === 4) break;
  }
  return [...seen];
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

  // Capped at 100. Deezer serves some playlists two hundred tracks deep, and a
  // page that long is a scroll nobody finishes — while every row is a card, an
  // image request and a row of controls.
  const tracks = (raw.tracks?.data ?? []).slice(0, 100).map(toTrack);
  const by = raw.creator?.name;

  return {
    kind,
    id,
    title: raw.title,
    subtitle: [`${raw.nb_tracks ?? tracks.length} songs`, by ? `by ${by}` : null, "on Deezer"]
      .filter(Boolean)
      .join(" · "),
    covers: coversOf(tracks),
    coverUrl: raw.picture_big ?? null,
    tracks,
  };
}

/**
 * A genre's chart, as something you can open and play.
 *
 * The name is looked up rather than passed in the URL, so the page cannot be
 * made to display a title of somebody else's choosing by editing the address.
 */
async function fromGenre(id: string): Promise<Collection | null> {
  const [chart, genres] = await Promise.all([
    deezer<{ tracks?: { data?: RawTrack[] } }>(`/chart/${id}?limit=50`, 3_600),
    deezer<{ data?: { id: number; name: string }[] }>("/genre", 604_800),
  ]);

  const tracks = (chart?.tracks?.data ?? []).map(toTrack);
  if (tracks.length === 0) return null;

  /*
   * The id has to name a genre Deezer actually publishes.
   *
   * `/chart/{id}` does not validate its path segment: a numeric id it does not
   * know returns an empty chart, which this already handled — but anything
   * *non-numeric* returns the **global** chart, byte for byte identical to
   * `/chart/0`. So `/collection/genre/abc` rendered the worldwide top songs
   * under the heading "Genre right now", and every made-up word in that slot
   * produced another page saying the same untrue thing.
   *
   * Falling back to the word "Genre" for an unknown name was what hid it. The
   * name is not decoration — it is the claim the page is making about where
   * these songs came from, and when it cannot be established there is no page
   * to render. `0` is the exception because it is the global chart by
   * definition, and says so in its title.
   */
  const name = genres?.data?.find((entry) => String(entry.id) === id)?.name;
  if (id !== "0" && name === undefined) return null;

  const title = id === "0" ? "Top songs this week" : `${name} right now`;

  return {
    kind: "genre",
    id,
    title,
    subtitle: `${tracks.length} songs · Deezer chart`,
    covers: coversOf(tracks),
    coverUrl: null,
    tracks,
  };
}

/**
 * A mood or a decade, resolved to a real playlist.
 *
 * Nothing is stored for these — the pill carries a search term and this finds
 * something to back it, so "Workout" and "1980s" cost nothing until somebody
 * presses them. The candidate with the most tracks wins, which is a rough proxy
 * for "the one somebody maintains" and beats taking whatever Deezer happens to
 * return first.
 */
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

  /*
   * The pill's own word is the heading, and the playlist it found is named
   * underneath.
   *
   * Pressing "Sleep" and arriving at a page headed "Classical sleep", with no
   * mention of sleep anywhere, reads as a broken link rather than as a good
   * match. Saying both keeps the promise the pill made and still credits what
   * is actually being played.
   */
  return {
    ...collection,
    id: term,
    title: label(term),
    subtitle: `${collection.title} · ${collection.subtitle}`,
  };
}

/** `hip-hop` → `Hip-Hop`, `1980s` → `1980s`. The pill's label, recovered. */
function label(term: string): string {
  return term
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((word) => (/^\d/.test(word) ? word : word[0]!.toUpperCase() + word.slice(1)))
    .join(" ");
}

/**
 * A Deezer radio — one of the categories Explore is built from.
 *
 * Its own tracks, not a search for its name: the station *is* the collection,
 * so there is nothing to resolve. The title comes from Deezer rather than from
 * the URL, so the heading cannot be dictated by editing the address.
 */
async function fromRadio(id: string): Promise<Collection | null> {
  const [meta, list] = await Promise.all([
    deezer<{ title?: string; picture_big?: string }>(`/radio/${id}`, 86_400),
    deezer<{ data?: RawTrack[] }>(`/radio/${id}/tracks`, 3_600),
  ]);

  const tracks = (list?.data ?? []).slice(0, 100).map(toTrack);
  if (tracks.length === 0) return null;

  return {
    kind: "radio",
    id,
    title: meta?.title ?? "Radio",
    subtitle: `${tracks.length} songs · Deezer radio`,
    covers: coversOf(tracks),
    coverUrl: meta?.picture_big ?? null,
    tracks,
  };
}

export async function fetchCollection(
  kind: CollectionKind,
  id: string,
): Promise<Collection | null> {
  if (kind === "genre") return fromGenre(id);
  if (kind === "playlist") return fromPlaylist(id, "playlist");
  if (kind === "radio") return fromRadio(id);
  return fromMood(id);
}
