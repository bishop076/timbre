"use client";

import { dedupeParts } from "@timbre/core";
import { useEffect, useMemo } from "react";

import { createLocalStore, readJson, useLocalStore, writeJson } from "../local-store.ts";
import { sameTrack, type TrackLike } from "../player/song-match.ts";
import { usableSongs } from "../song-shape.ts";
import type { Song } from "../types";

interface LikesState {
  songs: Song[];
  settled: boolean;
  error: string | null;
}

const KEY = "timbre:likes";

const store = createLocalStore<LikesState>({
  read: () => ({ songs: usableSongs(readJson(KEY)), settled: true, error: null }),
  initial: { songs: [], settled: false, error: null },
  keys: [KEY],
});

function persist(songs: Song[]): void {
  const error = writeJson(KEY, songs)
    ? null
    : "Out of browser storage, so new likes will be gone after a reload. Remove a playlist, or a profile picture.";
  store.publish({ songs, settled: true, error });
}

function cached<K extends object, V>(compute: (key: K) => V): (key: K) => V {
  const cache = new WeakMap<K, V>();
  return (key) => {
    if (!cache.has(key)) cache.set(key, compute(key));
    return cache.get(key)!;
  };
}

const keysOf = cached((song: TrackLike) => {
  const { base } = dedupeParts(song.title, song.artists);
  const keys = [`id:${song.id}`];
  if (song.isrc) keys.push(`isrc:${song.isrc}`);
  if (base) keys.push(`base:${base}`);
  return keys;
});

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

const indexOf = cached(buildIndex);

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

export function useLikes(): LikesState {
  useEffect(() => store.load(), []);
  return useLocalStore(store);
}

export function useIsLiked(song: TrackLike): boolean {
  const { songs } = useLikes();
  return useMemo(() => isLikedIn(songs, song), [songs, song]);
}

export function getLikedSongs(): Song[] {
  return store.getSnapshot().songs;
}

export const getLikesState = store.getSnapshot;

export function likeSong(song: Song): void {
  const songs = getLikedSongs();
  if (!isLikedIn(songs, song)) persist([stored(song), ...songs]);
}

export function unlikeSong(song: TrackLike): void {
  const songs = getLikedSongs();
  const found = matchesIn(indexOf(songs), song);
  if (found.size > 0) persist(songs.filter((entry) => !found.has(entry)));
}

export function importLikedSongs(value: unknown): number {
  const songs = getLikedSongs();
  const index = buildIndex(songs);
  const added: Song[] = [];

  for (const song of usableSongs(value)) {
    if (matchesIn(index, song).size > 0) continue;
    const entry = stored(song);
    added.push(entry);
    addTo(index, entry);
  }
  if (added.length > 0) persist([...songs, ...added]);
  return added.length;
}
