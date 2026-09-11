"use client";

import { dedupeParts } from "@timbre/core";
import { useMemo } from "react";

import { createLocalStore, useLocalStore } from "../local-store.ts";
import { sameTrack, type TrackLike } from "../player/song-match.ts";
import { usableSongs } from "../song-shape.ts";
import type { Song } from "../types";

export interface LikesState {
  songs: Song[];
  settled: boolean;
  error: string | null;
}

const KEY = "timbre:likes";

const EMPTY: LikesState = { songs: [], settled: false, error: null };

const OUT_OF_ROOM =
  "Out of browser storage, so new likes will be gone after a reload. Remove a playlist, or a profile picture.";

function readStorage(): Song[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    return usableSongs(JSON.parse(raw));
  } catch {
    return [];
  }
}

const store = createLocalStore<LikesState>({
  read: () => ({ songs: readStorage(), settled: true, error: null }),
  initial: EMPTY,
  keys: [KEY],
});

function liked(): Song[] {
  return store.getSnapshot().songs;
}

function persist(songs: Song[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(songs));
  } catch {
    store.publish({ songs, settled: true, error: OUT_OF_ROOM });
    return;
  }
  store.publish({ songs, settled: true, error: null });
}

const keysCache = new WeakMap<TrackLike, string[]>();

function keysOf(song: TrackLike): string[] {
  let keys = keysCache.get(song);
  if (!keys) {
    const { base } = dedupeParts(song.title, song.artists);
    keys = [`id:${song.id}`];
    if (song.isrc) keys.push(`isrc:${song.isrc}`);
    if (base) keys.push(`base:${base}`);
    keysCache.set(song, keys);
  }
  return keys;
}

type Index = Map<string, Song[]>;

function addTo(index: Index, song: Song): void {
  for (const key of keysOf(song)) {
    const bucket = index.get(key);
    if (bucket) bucket.push(song);
    else index.set(key, [song]);
  }
}

function buildIndex(songs: Song[]): Index {
  const index: Index = new Map();
  for (const song of songs) addTo(index, song);
  return index;
}

const indexCache = new WeakMap<Song[], Index>();

function indexOf(songs: Song[]): Index {
  let index = indexCache.get(songs);
  if (!index) {
    index = buildIndex(songs);
    indexCache.set(songs, index);
  }
  return index;
}

function matchesIn(index: Index, song: TrackLike): Set<Song> {
  const found = new Set<Song>();
  for (const key of keysOf(song)) {
    for (const entry of index.get(key) ?? []) {
      if (!found.has(entry) && sameTrack(entry, song)) found.add(entry);
    }
  }
  return found;
}

export function isLikedIn(songs: Song[], song: TrackLike): boolean {
  return matchesIn(indexOf(songs), song).size > 0;
}

function stored(song: Song): Song {
  return { ...song, from: undefined };
}

export const loadLikes = store.load;

export function useLikes(): LikesState {
  return useLocalStore(store);
}

export function useIsLiked(song: TrackLike | null): boolean {
  const { songs } = useLikes();
  return useMemo(() => (song ? isLikedIn(songs, song) : false), [songs, song]);
}

export function getLikedSongs(): Song[] {
  return liked();
}

export function getLikesState(): LikesState {
  return store.getSnapshot();
}

export function likeSong(song: Song): void {
  const songs = liked();
  if (isLikedIn(songs, song)) return;
  persist([stored(song), ...songs]);
}

export function unlikeSong(song: TrackLike): void {
  const songs = liked();
  const found = matchesIn(indexOf(songs), song);
  if (found.size === 0) return;
  persist(songs.filter((entry) => !found.has(entry)));
}

export function toggleLike(song: Song): boolean {
  if (isLikedIn(liked(), song)) {
    unlikeSong(song);
    return false;
  }
  likeSong(song);
  return true;
}

export function importLikedSongs(value: unknown): number {
  const songs = liked();
  const index = buildIndex(songs);
  const added: Song[] = [];

  for (const song of usableSongs(value)) {
    if (matchesIn(index, song).size > 0) continue;
    const entry = stored(song);
    added.push(entry);
    addTo(index, entry);
  }
  if (added.length === 0) return 0;

  persist([...songs, ...added]);
  return added.length;
}
