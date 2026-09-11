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

export interface RecommendOptions {
  limit: number;
  exclude?: Iterable<SongIdentity>;
}

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

function namesOfSong(song: Song): Names {
  const names: Names = { exact: [], loose: [] };

  for (const item of [song as SongIdentity, ...song.sources]) {
    const found = namesOf(item);
    names.exact.push(...found.exact);
    names.loose.push(...found.loose);
  }

  return names;
}

interface NameIndex {
  exact: Map<string, number>;
  loose: Map<string, { artists: string[]; rank: number }[]>;
}

function emptyIndex(): NameIndex {
  return { exact: new Map(), loose: new Map() };
}

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

function sharesArtist(left: string[], right: string[]): boolean {
  if (left.length === 0 || right.length === 0) return true;
  return left.some((name) => right.includes(name));
}

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
  const ytmusic = song.sources.find((source) => source.source === "ytmusic");
  if (!ytmusic) return PLAYABILITY_UNKNOWN;
  return PLAYABILITY[ytmusic.videoType ?? ""] ?? PLAYABILITY_UNKNOWN;
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

    let base = 0;
    let hits = 0;
    for (const index of indexed) {
      const rank = rankIn(index, names);
      if (rank === undefined) continue;
      base += 1 / (RRF_K + rank);
      hits += 1;
    }

    const consensus = 1 + CONSENSUS_WEIGHT * Math.max(0, hits - 1);

    return { song, score: base * consensus * playabilityOf(song), lists: hits, names };
  });
}

export function recommend(lists: RankedList[], options: RecommendOptions): Song[] {
  const excluded = indexOf(options.exclude ?? []);

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
    if (index === -1) index = 0;

    const [chosen] = pool.splice(index, 1);
    picked.push(chosen!.song);
    recent.push((chosen!.song.artists[0] ?? "").toLowerCase());
  }

  return picked;
}
