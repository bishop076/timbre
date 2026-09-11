import type { Song } from "../types";
import { sameTrack, type TrackLike } from "./song-match.ts";

const RANK_K = 6;
const ARTIST_WINDOW = 3;

interface Candidate {
  song: Song;
  rank: number;
}

const weight = (candidate: Candidate) => 1 / (RANK_K + candidate.rank);
const artistOf = (song: Song) => (song.artists[0] ?? "").toLowerCase();

function takeWeighted(from: Candidate[], random: () => number): Candidate {
  let ticket = random() * from.reduce((total, candidate) => total + weight(candidate), 0);
  for (let at = 0; at < from.length; at += 1) {
    ticket -= weight(from[at]);
    if (ticket <= 0) return from.splice(at, 1)[0];
  }
  return from.splice(0, 1)[0];
}

export function drawRadio(
  pool: readonly Song[],
  options: {
    exclude?: readonly TrackLike[];
    avoid?: readonly TrackLike[];
    count: number;
    random?: () => number;
  },
): Song[] {
  const { count, exclude = [], avoid = [], random = Math.random } = options;
  if (count <= 0) return [];

  const eligible: Candidate[] = [];
  const held: Song[] = [];
  pool.forEach((song, index) => {
    if (exclude.some((other) => sameTrack(other, song))) return;
    if (avoid.some((other) => sameTrack(other, song))) held.push(song);
    else eligible.push({ song, rank: index + 1 });
  });

  const picked: Song[] = [];
  while (picked.length < count && eligible.length > 0) {
    const recent = new Set(picked.slice(-(ARTIST_WINDOW - 1)).map(artistOf));
    const spaced = eligible.filter((candidate) => !recent.has(artistOf(candidate.song)));
    const from = spaced.length > 0 ? spaced : eligible;
    const chosen = takeWeighted(from, random);
    if (from !== eligible) eligible.splice(eligible.indexOf(chosen), 1);
    picked.push(chosen.song);
  }

  return [...picked, ...held.slice(0, count - picked.length)];
}
