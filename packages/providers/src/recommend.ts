/**
 * Ranking recommendations from several sources at once.
 *
 * Timbre's advantage over any single service is that it can ask several, and
 * they disagree. Seeded on *As It Was*, YouTube Music's watch queue offered
 * OneRepublic, The Weeknd and Stephen Sanchez while Deezer's artist radio
 * offered Taylor Swift, Reneé Rapp and Lorde. **A song that several
 * independently-built lists reach is a better bet than any one list's top
 * pick**, and that is a signal no single service can produce for itself.
 *
 * So this is rank fusion, not a model. There is no training data and there
 * could not be: a recommender needs retrieval plus ranking, and Timbre cannot
 * enumerate any catalogue to retrieve from. Retrieval is delegated to the
 * services; ranking is the part Timbre can honestly own. See
 * docs/RECOMMENDATIONS.md.
 *
 * Every term is multiplicative and scale-free, which matters: Reciprocal Rank
 * Fusion produces values around 0.016, so an additive bonus of any intuitive
 * size (0.25, say) would swamp the ranking entirely and turn every weight into
 * a tie-breaker. Multipliers stay meaningful whatever the list lengths are.
 */

import { dedupeKey } from "@timbre/core";

import { mergeTracks } from "./merge.ts";
import type { RankedList, Song, SourceTrack } from "./types.ts";

/**
 * Reciprocal Rank Fusion's damping constant.
 *
 * 60 is the value from the original paper and the usual default. It is what
 * stops the top one or two positions of any single list from dominating: at
 * k=60 the gap between rank 1 and rank 10 is small, so being *present in
 * several lists* outweighs being first in one — exactly the ordering this
 * feature exists to produce.
 */
const RRF_K = 60;

/** Each additional list that reached a song multiplies its score by this much. */
const CONSENSUS_WEIGHT = 0.5;

/**
 * How much an upload's kind moves it.
 *
 * Measured, not guessed: over 64 uploads in a real browser, art tracks were
 * barred from embedding ~7% of the time and official videos never were. A
 * recommendation that will not play is worth less than one that will, but the
 * effect is deliberately mild — the client's fall-through ladder is the actual
 * remedy, and demoting art tracks harder would bias the whole feature toward
 * music videos over songs.
 */
const PLAYABILITY: Record<string, number> = {
  MUSIC_VIDEO_TYPE_OMV: 1.15,
  MUSIC_VIDEO_TYPE_UGC: 1.0,
  MUSIC_VIDEO_TYPE_ATV: 0.8,
};
const PLAYABILITY_UNKNOWN = 0.95;

/** No artist may appear twice within this many consecutive picks. */
const ARTIST_WINDOW = 3;

/**
 * Enough of a song to recognise it. Deliberately structural rather than
 * `Song`, so the seed itself can be excluded without inventing an id and
 * a source list for it.
 */
export interface SongIdentity {
  title: string;
  artists: string[];
  isrc?: string | null;
}

export interface RecommendOptions {
  limit: number;
  /**
   * Songs not to suggest — the seed, whatever is already queued, or anything
   * played recently. Matched on the same normalized key the merger uses, so a
   * different upload of a song you just heard is still recognised as it.
   *
   * The seed matters more than it looks: YouTube Music drops it from its own
   * lists, but Deezer's top tracks happily include it, so without this the
   * first recommendation is frequently the song that just played.
   */
  exclude?: Iterable<SongIdentity>;
}

/** A song's identity for cross-list lookup: ISRC when known, else title+artists. */
function identityOf(title: string, artists: string[], isrc: string | null): string {
  return isrc ?? dedupeKey(title, artists);
}

/**
 * Best rank a song reached in one list, by identity.
 *
 * Ranks are 1-based, as RRF expects. A list that repeats a song keeps its
 * best position — a repeat is not extra evidence, it is the same evidence
 * twice.
 *
 * Identity here is looser than the merger's rule: it does not check duration.
 * The consequence is that a live take can inherit the studio version's rank,
 * which nudges a score. That is a very different cost from the merger's, where
 * the same looseness would collapse two recordings into one entry and play the
 * wrong song.
 */
function ranksIn(tracks: SourceTrack[]): Map<string, number> {
  const ranks = new Map<string, number>();
  tracks.forEach((track, index) => {
    const byKey = dedupeKey(track.title, track.artists);
    if (!ranks.has(byKey)) ranks.set(byKey, index + 1);
    if (track.isrc && !ranks.has(track.isrc)) ranks.set(track.isrc, index + 1);
  });
  return ranks;
}

function playabilityOf(song: Song): number {
  // Only YouTube Music reports an upload kind, and it is the only source that
  // actually plays, so it is the only one whose kind can matter.
  const ytmusic = song.sources.find((source) => source.source === "ytmusic");
  if (!ytmusic) return PLAYABILITY_UNKNOWN;
  return PLAYABILITY[ytmusic.videoType ?? ""] ?? PLAYABILITY_UNKNOWN;
}

export interface ScoredSong {
  song: Song;
  score: number;
  /** How many independent lists reached it. The multi-source payoff, visible. */
  lists: number;
}

/**
 * Scores every song the lists between them mention.
 *
 * Exported for tests and for anyone wanting to see *why* an order came out the
 * way it did, which is most of the argument for a rule-based ranker over a
 * learned one.
 */
export function scoreCandidates(lists: RankedList[]): ScoredSong[] {
  const usable = lists.filter((entry) => entry.tracks.length > 0);
  if (usable.length === 0) return [];

  // Merge across every list at once, so one song found by several services
  // becomes one entry carrying all of them.
  const songs = mergeTracks(usable.flatMap((entry) => entry.tracks));
  const ranked = usable.map((entry) => ranksIn(entry.tracks));

  return songs.map((song) => {
    const identity = identityOf(song.title, song.artists, song.isrc);
    const fallback = dedupeKey(song.title, song.artists);

    let base = 0;
    let hits = 0;
    for (const ranks of ranked) {
      const rank = ranks.get(identity) ?? ranks.get(fallback);
      if (rank === undefined) continue;
      base += 1 / (RRF_K + rank);
      hits += 1;
    }

    // A song reached by two lists scores 1.5x, by three 2x. Combined with RRF
    // already summing one term per list, agreement compounds — which is the
    // whole point.
    const consensus = 1 + CONSENSUS_WEIGHT * Math.max(0, hits - 1);

    return { song, score: base * consensus * playabilityOf(song), lists: hits };
  });
}

/**
 * Ranks and diversifies, returning at most `limit` songs.
 *
 * The final pass is greedy rather than a plain sort: taking the top N by score
 * reliably produces four songs by the seed's own artist, because every service
 * ranks an artist's own catalogue highly. Spacing artists out is what makes it
 * a radio rather than a discography — and it is done by *reordering*, never by
 * dropping, so a seed whose every suggestion shares an artist still returns a
 * full list.
 */
export function recommend(lists: RankedList[], options: RecommendOptions): Song[] {
  const excluded = new Set<string>();
  for (const song of options.exclude ?? []) {
    excluded.add(identityOf(song.title, song.artists, song.isrc ?? null));
    excluded.add(dedupeKey(song.title, song.artists));
  }

  /*
   * One entry per song, by title and artist alone.
   *
   * The merger deliberately keeps a music video and its audio track apart —
   * "Watermelon Sugar (Official Video)" runs 189s against the track's 174s, and
   * beyond its 3s tolerance those are different recordings, which is exactly
   * right when the question is "which services have this song".
   *
   * In a radio it is not right: the user sees the same song twice in twelve.
   * So the duration guard is dropped **here only**, after scoring, keeping the
   * higher-scored of the pair. That is the copy with a playable source, since
   * the playability term is what separates them.
   */
  const kept = new Set<string>();

  const pool = scoreCandidates(lists)
    .filter((candidate) => {
      const key = dedupeKey(candidate.song.title, candidate.song.artists);
      const identity = identityOf(candidate.song.title, candidate.song.artists, candidate.song.isrc);
      return !excluded.has(key) && !excluded.has(identity);
    })
    .sort((a, b) => b.score - a.score)
    .filter((candidate) => {
      const key = dedupeKey(candidate.song.title, candidate.song.artists);
      if (kept.has(key)) return false;
      kept.add(key);
      return true;
    });

  const picked: Song[] = [];
  const recent: string[] = [];

  while (picked.length < options.limit && pool.length > 0) {
    const window = new Set(recent.slice(-(ARTIST_WINDOW - 1)));
    let index = pool.findIndex(
      (candidate) => !window.has((candidate.song.artists[0] ?? "").toLowerCase()),
    );
    // Everything left repeats a recent artist. Take the best one anyway rather
    // than returning a short list.
    if (index === -1) index = 0;

    const [chosen] = pool.splice(index, 1);
    picked.push(chosen!.song);
    recent.push((chosen!.song.artists[0] ?? "").toLowerCase());
  }

  return picked;
}
