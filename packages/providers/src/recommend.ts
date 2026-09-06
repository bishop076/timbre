/**
 * Rank fusion across several sources — a song several lists reach beats any one list's top
 * pick. See docs/RECOMMENDATIONS.md. Every term is multiplicative and scale-free: RRF
 * produces values near 0.016, so an additive bonus of any intuitive size swamps the lot.
 */

import { dedupeKey, dedupeParts } from "@timbre/core";

import { mergeTracks } from "./merge.ts";
import type { RankedList, Song } from "./types.ts";

/** RRF damping, 60 from the paper: keeps rank 1 close to rank 10, so presence in several
 * lists outweighs being first in one. */
const RRF_K = 60;

/** Each additional list that reached a song multiplies its score by this much. */
const CONSENSUS_WEIGHT = 0.5;

/** How much an upload's kind moves it. Measured over 64 uploads: art tracks barred from
 * embedding ~7% of the time, official videos never. Mild, or the feature tilts to videos. */
const PLAYABILITY: Record<string, number> = {
  MUSIC_VIDEO_TYPE_OMV: 1.15,
  MUSIC_VIDEO_TYPE_UGC: 1.0,
  MUSIC_VIDEO_TYPE_ATV: 0.8,
};
const PLAYABILITY_UNKNOWN = 0.95;

/** No artist may appear twice within this many consecutive picks. */
const ARTIST_WINDOW = 3;

/** Enough of a song to recognise it — structural, so the seed needs no invented id. */
export interface SongIdentity {
  title: string;
  artists: string[];
  isrc?: string | null;
}

export interface RecommendOptions {
  limit: number;
  /** Songs not to suggest, matched on the merger's normalized key. The seed matters: Deezer's
   * top tracks include it, so without this the first recommendation is often what just played. */
  exclude?: Iterable<SongIdentity>;
}

/**
 * Every name one recording answers to, because a lookup has to survive two services
 * spelling it differently.
 *
 * `exact` is an ISRC or the merger's own key, and settles the ordinary case for nothing.
 * `loose` exists for the disagreement that actually happens: **a featured artist credited in
 * one place and dropped in another.** YouTube Music lists *Sunflower (feat. Swae Lee)* by
 * Post Malone; Deezer lists *Sunflower* by Post Malone. `dedupeKey` folds the feature into
 * the artists, so those are two different keys — while the merger groups the tracks anyway,
 * so the song comes out of the merge carrying one spelling and unfindable under the other.
 * It then scored as though only one list had reached it, which is the opposite of the truth,
 * and cost it the consensus multiplier this whole file exists to apply.
 *
 * So the loose form keeps the title and softens the credits to a set that only has to
 * *intersect*. Variants stay in the key, unlike `sameRecording`'s: a live take and the studio
 * cut are different recordings, and letting one inherit the other's rank would promote
 * whichever of the two the lists happened to disagree about.
 */
interface Names {
  exact: string[];
  loose: { key: string; artists: string[] }[];
}

function namesOf(item: SongIdentity): Names {
  const key = dedupeKey(item.title, item.artists);
  const parts = dedupeParts(item.title, item.artists);

  return {
    exact: item.isrc ? [item.isrc, key] : [key],
    loose: [{ key: `${parts.base}|${parts.variants.join("+")}`, artists: parts.artists }],
  };
}

/** A merged song answers to its own name *and* to each source's: the sources are the rows
 * the lists were indexed by, and the merger kept every one it grouped. */
function namesOfSong(song: Song): Names {
  const names: Names = { exact: [], loose: [] };

  for (const item of [song as SongIdentity, ...song.sources]) {
    const found = namesOf(item);
    names.exact.push(...found.exact);
    names.loose.push(...found.loose);
  }

  return names;
}

/** A set of songs, searchable by any of their names. The value is a 1-based rank when the
 * set is a ranked list, and unused when the set is only asked *whether* it holds something. */
interface NameIndex {
  exact: Map<string, number>;
  loose: Map<string, { artists: string[]; rank: number }[]>;
}

function emptyIndex(): NameIndex {
  return { exact: new Map(), loose: new Map() };
}

/** First mention wins: a repeat inside one list is the same evidence twice, not more of it. */
function addNames(index: NameIndex, names: Names, rank: number): void {
  for (const key of names.exact) {
    if (!index.exact.has(key)) index.exact.set(key, rank);
  }

  for (const entry of names.loose) {
    const bucket = index.loose.get(entry.key);
    if (bucket) bucket.push({ artists: entry.artists, rank });
    else index.loose.set(entry.key, [{ artists: entry.artists, rank }]);
  }
}

function indexOf(items: Iterable<SongIdentity>): NameIndex {
  const index = emptyIndex();
  let rank = 0;
  for (const item of items) addNames(index, namesOf(item), ++rank);
  return index;
}

/** Skipped rather than failed when either side credits nobody: a list can carry a row with
 * no artist at all, and refusing everything then would lose the lookup this exists to make. */
function sharesArtist(left: string[], right: string[]): boolean {
  if (left.length === 0 || right.length === 0) return true;
  return left.some((name) => right.includes(name));
}

/** The best rank this song reached, or undefined when the index does not name it. Exact
 * first and only then loose, so a precise match is never beaten by a softer one. */
function rankIn(index: NameIndex, names: Names): number | undefined {
  let best: number | undefined;

  for (const key of names.exact) {
    const rank = index.exact.get(key);
    if (rank !== undefined && (best === undefined || rank < best)) best = rank;
  }
  if (best !== undefined) return best;

  for (const name of names.loose) {
    for (const entry of index.loose.get(name.key) ?? []) {
      if (!sharesArtist(name.artists, entry.artists)) continue;
      if (best === undefined || entry.rank < best) best = entry.rank;
    }
  }

  return best;
}

function playabilityOf(song: Song): number {
  // Only YouTube Music reports a kind, and it is the only source that actually plays.
  const ytmusic = song.sources.find((source) => source.source === "ytmusic");
  if (!ytmusic) return PLAYABILITY_UNKNOWN;
  return PLAYABILITY[ytmusic.videoType ?? ""] ?? PLAYABILITY_UNKNOWN;
}

export interface ScoredSong {
  song: Song;
  score: number;
  /** How many independent lists reached it. */
  lists: number;
  /** Every name it answers to — built to score it, and reused to deduplicate and exclude it
   * rather than derived again from a single key that would miss in the same way. */
  names: Names;
}

/** Scores every song the lists mention. Exported so an order can be explained. */
export function scoreCandidates(lists: RankedList[]): ScoredSong[] {
  const usable = lists.filter((entry) => entry.tracks.length > 0);
  if (usable.length === 0) return [];

  // Merged across every list at once, so one song found by several services is one entry.
  const songs = mergeTracks(usable.flatMap((entry) => entry.tracks));
  const indexed = usable.map((entry) => indexOf(entry.tracks));

  return songs.map((song) => {
    const names = namesOfSong(song);

    let base = 0;
    let hits = 0;
    for (const index of indexed) {
      const rank = rankIn(index, names);
      if (rank === undefined) continue;
      base += 1 / (RRF_K + rank);
      hits += 1;
    }

    // Two lists 1.5x, three 2x; RRF already sums per list, so agreement compounds.
    const consensus = 1 + CONSENSUS_WEIGHT * Math.max(0, hits - 1);

    return { song, score: base * consensus * playabilityOf(song), lists: hits, names };
  });
}

/** Ranks and diversifies, at most `limit` songs. Greedy, not a plain sort: every service
 * ranks an artist's own catalogue highly, so the top N is four songs by the seed's artist.
 * Spacing reorders, never drops. */
export function recommend(lists: RankedList[], options: RecommendOptions): Song[] {
  // Indexed the way the lists are, so an exclusion written one way still catches the copy
  // spelled the other. This is what stops the song that *just played* returning as its own
  // first recommendation: the seed is credited however the source that played it credits
  // features, and a plain key comparison missed precisely those songs — which is how a
  // radio ends up circling the same handful of tracks.
  const excluded = indexOf(options.exclude ?? []);

  /* One entry per song. The merger keeps a music video and its audio track apart (189s vs
   * 174s, past its 3s tolerance), which in a radio shows as the same song twice — so the
   * duration guard is dropped here only, after scoring. Matched on names rather than one
   * key, because those two copies are exactly where a title is decorated differently. */
  const kept = emptyIndex();

  const pool = scoreCandidates(lists)
    .filter((candidate) => rankIn(excluded, candidate.names) === undefined)
    .sort((a, b) => b.score - a.score)
    .filter((candidate) => {
      if (rankIn(kept, candidate.names) !== undefined) return false;
      addNames(kept, candidate.names, 1);
      return true;
    });

  const picked: Song[] = [];
  const recent: string[] = [];

  while (picked.length < options.limit && pool.length > 0) {
    const window = new Set(recent.slice(-(ARTIST_WINDOW - 1)));
    let index = pool.findIndex(
      (candidate) => !window.has((candidate.song.artists[0] ?? "").toLowerCase()),
    );
    // Everything left repeats a recent artist — take the best rather than return short.
    if (index === -1) index = 0;

    const [chosen] = pool.splice(index, 1);
    picked.push(chosen!.song);
    recent.push((chosen!.song.artists[0] ?? "").toLowerCase());
  }

  return picked;
}
