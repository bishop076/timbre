"use client";

/**
 * Liked songs, in the browser — the one list that needs no choosing. Kept apart from the
 * playlists rather than as a playlist with a reserved name: a like is a yes/no on a
 * recording, so it dedupes, and a playlist deliberately does not (see `addSongToPlaylist`).
 *
 * Whole songs, as the playlists store them, so the list renders and plays with no network.
 * Same costs too, stated in the same places: only on this device, and gone with site data.
 *
 * **Not bounded by count.** Storage is ~5 MB per origin, shared with the playlists and the
 * profile pictures, and a song with every source attached runs to a couple of KB — so a
 * thousand likes is a couple of MB. A cap would have to either drop the oldest likes, which
 * is the one thing a likes list must never do quietly, or refuse new ones, which is what
 * running out of quota already does, only earlier and for a reason nobody could see. So the
 * quota is the bound, and hitting it is reported the way the playlists report it.
 */

import { dedupeParts } from "@timbre/core";
import { useMemo } from "react";

import { createLocalStore, useLocalStore } from "../local-store.ts";
import { sameTrack, type TrackLike } from "../player/song-match.ts";
import { usableSongs } from "../song-shape.ts";
import type { Song } from "../types";

export interface LikesState {
  /** Newest first. */
  songs: Song[];
  /** False until the first read, so "nothing liked" and "not looked yet" differ. */
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
    // A trust boundary like any other: an older Timbre or a hand edit may have left
    // something no row can render — see `usableSongs`.
    return usableSongs(JSON.parse(raw));
  } catch {
    // Corrupt JSON, or storage blocked entirely.
    return [];
  }
}

const store = createLocalStore<LikesState>({
  read: () => ({ songs: readStorage(), settled: true, error: null }),
  initial: EMPTY,
  keys: [KEY],
});

/** The list in hand, reading storage first if nothing has yet. A write must start from what
 * is stored — starting from the empty pre-read value would overwrite every like with one. */
function liked(): Song[] {
  return store.getSnapshot().songs;
}

/** Writes, then publishes — the failure included, so it is shown rather than looking like a
 * save that worked until the next reload. The change stays for this session either way. */
function persist(songs: Song[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(songs));
  } catch {
    store.publish({ songs, settled: true, error: OUT_OF_ROOM });
    return;
  }
  store.publish({ songs, settled: true, error: null });
}

// Finding a song in the list
//
// `sameTrack` decides, but it cannot be asked of every entry. It parses both titles on each
// call — measured at ~30 µs a pair — so with a thousand likes every heart cost ~30 ms to
// draw and an import of a thousand more took half a minute. The index below only narrows
// the question to the entries that *could* match: `sameTrack` says yes on a shared id, a
// shared ISRC, or a shared base title, so an entry sharing none of those is never a match
// and never needs asking.

/** The keys under which a song could meet its duplicate. Cached per object: songs are never
 * mutated here, and the parse is the expensive part. */
const keysCache = new WeakMap<TrackLike, string[]>();

function keysOf(song: TrackLike): string[] {
  let keys = keysCache.get(song);
  if (!keys) {
    const { base } = dedupeParts(song.title, song.artists);
    keys = [`id:${song.id}`];
    if (song.isrc) keys.push(`isrc:${song.isrc}`);
    // An empty base never matches on its own, so it is not a key.
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

/** Cached per list. Safe only because a published list is never mutated — every write
 * builds a new array — so anything that grows a list builds its own with `buildIndex`. */
const indexCache = new WeakMap<Song[], Index>();

function indexOf(songs: Song[]): Index {
  let index = indexCache.get(songs);
  if (!index) {
    index = buildIndex(songs);
    indexCache.set(songs, index);
  }
  return index;
}

/** Every entry that is the same recording as `song` — one, normally, but a list written
 * by an older Timbre, or by hand, may hold two. */
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

/** A song as it is stored. Without `from`: that says which page a queue was started on, and
 * a like carried from an artist's queue would otherwise count as "played from that artist"
 * every time the list played it — the reason `addSongToPlaylist` drops it too. */
function stored(song: Song): Song {
  return { ...song, from: undefined };
}

// Reading

/** Reads storage once, on mount — the first read cannot happen during render, because the
 * server has no localStorage. */
export const loadLikes = store.load;

export function useLikes(): LikesState {
  return useLocalStore(store);
}

/** Whether a song is liked. Memoised because the player bar re-renders on every tick of the
 * clock, and the answer only changes with the list or the song. */
export function useIsLiked(song: TrackLike | null): boolean {
  const { songs } = useLikes();
  return useMemo(() => (song ? isLikedIn(songs, song) : false), [songs, song]);
}

/** Every liked song, newest first — for an export, which runs outside React. */
export function getLikedSongs(): Song[] {
  return liked();
}

/** The whole state outside React, for a caller that has to say whether a write held. */
export function getLikesState(): LikesState {
  return store.getSnapshot();
}

// Writing

/** Likes a song, at the top. Already liked is a no-op rather than a move: a second press on
 * a filled heart from a stale tab should not reorder the list. */
export function likeSong(song: Song): void {
  const songs = liked();
  if (isLikedIn(songs, song)) return;
  persist([stored(song), ...songs]);
}

/** Unlikes every copy of the recording, so no stray duplicate keeps the heart filled. */
export function unlikeSong(song: TrackLike): void {
  const songs = liked();
  const found = matchesIn(indexOf(songs), song);
  if (found.size === 0) return;
  persist(songs.filter((entry) => !found.has(entry)));
}

/** Flips a song, returning whether it is now liked. */
export function toggleLike(song: Song): boolean {
  if (isLikedIn(liked(), song)) {
    unlikeSong(song);
    return false;
  }
  likeSong(song);
  return true;
}

/**
 * Merges songs from outside — an export file — returning how many were new. Checked, since
 * a file is the least trustworthy input the app has; deduped against what is here and
 * against itself; and added **after** the likes already here, in the file's own order, so
 * an import never reorders or replaces anything. The file format is the caller's: this takes
 * the array.
 */
export function importLikedSongs(value: unknown): number {
  const songs = liked();
  // Its own index, not the cached one: it grows as the file is read, so a song repeated
  // within the file is caught as well as one already liked.
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
