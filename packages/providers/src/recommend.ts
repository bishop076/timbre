import { dedupeKey, dedupeParts } from "@timbre/core";

import { mergeTracks } from "./merge.ts";
import type { RankedList, Song } from "./types.ts";

const RRF_K = 60;
const CONSENSUS_WEIGHT = 0.5;
const PLAYABILITY: Record<string, number> = {
  MUSIC_VIDEO_TYPE_OMV: 1.15,
  MUSIC_VIDEO_TYPE_OFFICIAL_SOURCE_MUSIC: 1.15,
  MUSIC_VIDEO_TYPE_UGC: 1.0,
  MUSIC_VIDEO_TYPE_ATV: 0.8,
  MUSIC_VIDEO_TYPE_PODCAST_EPISODE: 0.6,
  MUSIC_VIDEO_TYPE_SHOULDER: 0.6,
};
const PLAYABILITY_UNKNOWN = 0.95;
const ARTIST_WINDOW = 3;

export interface SongIdentity {
  title: string;
  artists: string[];
  isrc?: string | null;
}

interface Names {
  exact: string[];
  loose: { key: string; artists: string[] }[];
}

function namesOf({ title, artists, isrc }: SongIdentity): Names {
  const key = dedupeKey(title, artists);
  const parts = dedupeParts(title, artists);
  return {
    exact: isrc ? [isrc, key] : [key],
    loose: [{ key: `${parts.base}|${parts.variants.join("+")}`, artists: parts.artists }],
  };
}

function namesOfSong(song: Song): Names {
  const all = [song, ...song.sources].map(namesOf);
  return { exact: all.flatMap((names) => names.exact), loose: all.flatMap((names) => names.loose) };
}

interface NameIndex {
  exact: Map<string, number>;
  loose: Map<string, { artists: string[]; rank: number }[]>;
}

function addNames(index: NameIndex, names: Names, rank: number): void {
  for (const key of names.exact) {
    if (!index.exact.has(key)) index.exact.set(key, rank);
  }
  for (const { key, artists } of names.loose) {
    index.loose.set(key, [...(index.loose.get(key) ?? []), { artists, rank }]);
  }
}

function indexOf(items: Iterable<SongIdentity>): NameIndex {
  const index: NameIndex = { exact: new Map(), loose: new Map() };
  let rank = 0;
  for (const item of items) addNames(index, namesOf(item), ++rank);
  return index;
}

function sharesArtist(left: string[], right: string[]): boolean {
  return left.length === 0 || right.length === 0 || left.some((name) => right.includes(name));
}

function rankIn(index: NameIndex, names: Names): number | undefined {
  const exact = names.exact.flatMap((key) => index.exact.get(key) ?? []);
  if (exact.length > 0) return Math.min(...exact);

  const loose = names.loose.flatMap(({ key, artists }) =>
    (index.loose.get(key) ?? [])
      .filter((entry) => sharesArtist(artists, entry.artists))
      .map((entry) => entry.rank),
  );
  return loose.length > 0 ? Math.min(...loose) : undefined;
}

function playabilityOf(song: Song): number {
  const ytmusic = song.sources.find((source) => source.source === "ytmusic");
  return PLAYABILITY[ytmusic?.videoType ?? ""] ?? PLAYABILITY_UNKNOWN;
}

export interface ScoredSong {
  song: Song;
  score: number;
  lists: number;
  names: Names;
}

export function scoreCandidates(lists: RankedList[]): ScoredSong[] {
  const usable = lists.filter((entry) => entry.tracks.length > 0);
  if (usable.length === 0) return [];

  const songs = mergeTracks(usable.flatMap((entry) => entry.tracks));
  const indexed = usable.map((entry) => indexOf(entry.tracks));

  return songs.map((song) => {
    const names = namesOfSong(song);
    const ranks = indexed.flatMap((index) => rankIn(index, names) ?? []);
    const base = ranks.reduce((sum, rank) => sum + 1 / (RRF_K + rank), 0);
    const consensus = 1 + CONSENSUS_WEIGHT * Math.max(0, ranks.length - 1);
    return { song, score: base * consensus * playabilityOf(song), lists: ranks.length, names };
  });
}

const leadArtist = (song: Song) => (song.artists[0] ?? "").toLowerCase();

export function recommend(
  lists: RankedList[],
  options: { limit: number; exclude?: Iterable<SongIdentity> },
): Song[] {
  const excluded = indexOf(options.exclude ?? []);
  const kept = indexOf([]);

  const pool = scoreCandidates(lists)
    .filter((candidate) => rankIn(excluded, candidate.names) === undefined)
    .sort((a, b) => b.score - a.score)
    .filter((candidate) => {
      if (rankIn(kept, candidate.names) !== undefined) return false;
      addNames(kept, candidate.names, 1);
      return true;
    });

  const picked: Song[] = [];
  while (picked.length < options.limit && pool.length > 0) {
    const recent = new Set(picked.slice(-(ARTIST_WINDOW - 1)).map(leadArtist));
    const index = pool.findIndex(({ song }) => !recent.has(leadArtist(song)));
    picked.push(pool.splice(Math.max(index, 0), 1)[0]!.song);
  }
  return picked;
}
