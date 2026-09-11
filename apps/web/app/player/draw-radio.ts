import type { Song } from "../types";
import { sameTrack, type TrackLike } from "./song-match.ts";

const RANK_K = 6;

const ARTIST_WINDOW = 3;

export interface DrawOptions {
  exclude?: readonly TrackLike[];
  avoid?: readonly TrackLike[];
  count: number;
  random?: () => number;
}

interface Candidate {
  song: Song;
  rank: number;
}

function takeWeighted(from: Candidate[], random: () => number): Candidate {
  let total = 0;
  for (const candidate of from) total += 1 / (RANK_K + candidate.rank);

  let ticket = random() * total;
  for (let at = 0; at < from.length; at += 1) {
    ticket -= 1 / (RANK_K + from[at]!.rank);
    if (ticket <= 0) return from.splice(at, 1)[0]!;
  }

  return from.splice(0, 1)[0]!;
}

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

    const from = spaced.length > 0 ? spaced : eligible;
    const chosen = takeWeighted(from, random);

    if (from !== eligible) {
      eligible.splice(eligible.indexOf(chosen), 1);
    }

    record(chosen);
  }

  for (const candidate of held) {
    if (picked.length >= count) break;
    record(candidate);
  }

  return picked;
}
