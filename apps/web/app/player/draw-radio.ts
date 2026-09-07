/**
 * Draws a listening order out of a ranked pool, so the same song does not open the same
 * queue every time.
 *
 * **Why the client draws rather than the server ranking differently.** `recommend.ts` is a
 * deterministic rule, and it should stay one: the same evidence ought to produce the same
 * ranking, that is what makes it testable and what `docs/RECOMMENDATIONS.md` argues for at
 * length. It is also cached for an hour per seed, so a server that shuffled would hand the
 * *same* shuffle back to every request inside that hour and vary nothing at all.
 *
 * So the split is: the service ranks, the device draws. The route returns a pool of 50
 * ranked candidates, cacheable and identical for everyone, and each play takes 25 of them
 * with the choice weighted by rank. Two plays of the same song then share a pool and differ
 * in what comes out of it — which is what "play something else this time" actually means.
 *
 * It also puts listening history where the rest of this app keeps it. History is device
 * local and has no account behind it (`history-store.ts`); avoiding what you have already
 * heard is therefore something only the client *can* do, and doing it here means the queue
 * moves on without a personal listening record being sent anywhere.
 */

import type { Song } from "../types";
import { sameTrack, type TrackLike } from "./song-match.ts";

/** Rank damping for the draw weight, `1 / (RANK_K + rank)`.
 *
 * Small on purpose, and the one number here worth arguing about. At 6, the top of a 50-song
 * pool is about eight times likelier than the bottom: the ranking still decides most of what
 * is heard, while nothing in the pool is unreachable. Raising it flattens towards a shuffle
 * — at which point the fusion in `recommend.ts` has been thrown away — and lowering it
 * towards zero returns the fixed order this exists to break. */
const RANK_K = 6;

/** No artist twice within this many consecutive picks. Mirrors `recommend.ts`, which spaces
 * its own output; a draw that reorders the pool has to keep the rule or lose it. */
const ARTIST_WINDOW = 3;

export interface DrawOptions {
  /** Never drawn, at any price — the songs already in the queue. Drawing one of these is
   * the duplicate this whole area was fixed for. */
  exclude?: readonly TrackLike[];
  /** Avoided while anything else is left, then allowed rather than returning short. Recently
   * played songs: a radio that refuses them outright runs out of catalogue on a small pool,
   * and a queue that stops is worse than one that eventually repeats. */
  avoid?: readonly TrackLike[];
  count: number;
  /** Injected so a test can be exact about a draw. Defaults to `Math.random`. */
  random?: () => number;
}

interface Candidate {
  song: Song;
  /** 1-based position in the pool, which is the only quality signal that survives the trip
   * from the ranker — scores are not serialised over the wire. */
  rank: number;
}

/** Picks one, weighted by rank, and takes it out of `from`. */
function takeWeighted(from: Candidate[], random: () => number): Candidate {
  let total = 0;
  for (const candidate of from) total += 1 / (RANK_K + candidate.rank);

  let ticket = random() * total;
  for (let at = 0; at < from.length; at += 1) {
    ticket -= 1 / (RANK_K + from[at]!.rank);
    // `<= 0` rather than `< 0`: a `random()` of exactly 0 must still select something, and
    // floating-point drift can leave the final ticket a hair above zero on the last entry.
    if (ticket <= 0) return from.splice(at, 1)[0]!;
  }

  // Unreachable while the pool is non-empty, and a fall back to the best rather than a throw:
  // this runs while music is playing, and no continuation is a worse answer than a safe one.
  return from.splice(0, 1)[0]!;
}

/**
 * Draws up to `count` songs from `pool`, weighted towards the top of it and spaced by artist.
 *
 * Order is the draw order, so this is a running order rather than a ranking.
 */
export function drawRadio(pool: readonly Song[], options: DrawOptions): Song[] {
  const { count, exclude = [], avoid = [], random = Math.random } = options;
  if (count <= 0) return [];

  const eligible: Candidate[] = [];
  const held: Candidate[] = [];

  pool.forEach((song, index) => {
    const candidate = { song, rank: index + 1 };
    if (exclude.some((other) => sameTrack(other, song))) return;
    if (avoid.some((other) => sameTrack(other, song))) held.push(candidate);
    else eligible.push(candidate);
  });

  const picked: Song[] = [];
  const recent: string[] = [];

  const record = (candidate: Candidate) => {
    picked.push(candidate.song);
    recent.push((candidate.song.artists[0] ?? "").toLowerCase());
  };

  while (picked.length < count && eligible.length > 0) {
    const window = new Set(recent.slice(-(ARTIST_WINDOW - 1)));
    const spaced = eligible.filter(
      (candidate) => !window.has((candidate.song.artists[0] ?? "").toLowerCase()),
    );

    // Everything left repeats a recent artist — draw from all of it rather than stop short,
    // exactly as the ranker's own spacing yields when an artist owns what remains.
    const from = spaced.length > 0 ? spaced : eligible;
    const chosen = takeWeighted(from, random);

    // `takeWeighted` spliced it out of `spaced`, which is a copy when it is not `eligible`.
    if (from !== eligible) {
      eligible.splice(eligible.indexOf(chosen), 1);
    }

    record(chosen);
  }

  // Topped up in rank order, not drawn: these are the songs already heard, so what matters
  // is that the queue continues, and the best of them is the least bad way to continue it.
  for (const candidate of held) {
    if (picked.length >= count) break;
    record(candidate);
  }

  return picked;
}
