/**
 * Rank fusion across several sources — a song several lists reach beats any one list's top
 * pick. See docs/RECOMMENDATIONS.md. Every term is multiplicative and scale-free: RRF
 * produces values near 0.016, so an additive bonus of any intuitive size swamps the lot.
 */

import { dedupeKey } from "@timbre/core";

import { mergeTracks } from "./merge.ts";
import type { RankedList, Song, SourceTrack } from "./types.ts";

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

/** A song's identity for cross-list lookup: ISRC when known, else title+artists. */
function identityOf(title: string, artists: string[], isrc: string | null): string {
  return isrc ?? dedupeKey(title, artists);
}

/** Best 1-based rank a song reached in one list — a repeat is the same evidence twice.
 * Identity is looser than the merger's (no duration check), so a live take can inherit the
 * studio rank: cheap here, but in the merger it would play the wrong song. */

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
}

/** Scores every song the lists mention. Exported so an order can be explained. */
export function scoreCandidates(lists: RankedList[]): ScoredSong[] {
  const usable = lists.filter((entry) => entry.tracks.length > 0);
  if (usable.length === 0) return [];

  // Merged across every list at once, so one song found by several services is one entry.
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

    // Two lists 1.5x, three 2x; RRF already sums per list, so agreement compounds.
    const consensus = 1 + CONSENSUS_WEIGHT * Math.max(0, hits - 1);

    return { song, score: base * consensus * playabilityOf(song), lists: hits };
  });
}

/** Ranks and diversifies, at most `limit` songs. Greedy, not a plain sort: every service
 * ranks an artist's own catalogue highly, so the top N is four songs by the seed's artist.
 * Spacing reorders, never drops. */
export function recommend(lists: RankedList[], options: RecommendOptions): Song[] {
  const excluded = new Set<string>();
  for (const song of options.exclude ?? []) {
    excluded.add(identityOf(song.title, song.artists, song.isrc ?? null));
    excluded.add(dedupeKey(song.title, song.artists));
  }

  /* One entry per song, by title and artist alone. The merger keeps a music video and its
   * audio track apart (189s vs 174s, past its 3s tolerance), which in a radio shows as the same
   * song twice — so the duration guard is dropped here only, after scoring. */

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
    // Everything left repeats a recent artist — take the best rather than return short.
    if (index === -1) index = 0;

    const [chosen] = pool.splice(index, 1);
    picked.push(chosen!.song);
    recent.push((chosen!.song.artists[0] ?? "").toLowerCase());
  }

  return picked;
}
