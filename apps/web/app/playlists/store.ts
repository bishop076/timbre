"use client";

/**
 * Playlists, in the browser — no database, no accounts, no personal data. The cost, stated
 * wherever these appear: clearing site data loses them and they do not follow you to
 * another device, which is why export is a first-class feature. A playlist stores whole
 * songs, not references, so a saved list renders and plays with no network at all.
 */

import { createLocalStore, useLocalStore } from "../local-store.ts";
import type { Song } from "../types";

export interface LocalPlaylist {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  songs: Song[];
}

/** What list views need, without carrying every song into every render. */
export interface PlaylistSummary {
  id: string;
  name: string;
  trackCount: number;
  covers: string[];
  updatedAt: string;
}

export interface PlaylistsState {
  playlists: PlaylistSummary[] | null;
  /** False until the first read, so "empty" and "not looked yet" differ. */
  settled: boolean;
  error: string | null;
}

const KEY = "timbre:playlists";

const EMPTY: PlaylistsState = { playlists: null, settled: false, error: null };

let all: LocalPlaylist[] = [];

function summarise(playlist: LocalPlaylist): PlaylistSummary {
  return {
    id: playlist.id,
    name: playlist.name,
    trackCount: playlist.songs.length,
    covers: playlist.songs
      .map((song) => song.artworkUrl)
      .filter((url): url is string => Boolean(url))
      .slice(0, 4),
    updatedAt: playlist.updatedAt,
  };
}

/** The state for the playlists in hand, most recently touched first. */
function state(error: string | null): PlaylistsState {
  return {
    playlists: [...all]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(summarise),
    settled: true,
    error,
  };
}

/**
 * A playlist's songs, with anything that would throw downstream removed.
 *
 * `Array.isArray(songs)` used to be the entire check, in **both** places a playlist can
 * arrive — and nothing downstream guards a field before reading it: `summarise` below
 * reads `song.artworkUrl`, the player reads `song.sources.find(…)`, and every row reads
 * `song.artists.join(…)`. One `null` in this array was therefore a TypeError thrown
 * during render, from the sidebar, on every route — and `persist` had already written it
 * to storage, so it came back on every later load. See docs/SECURITY.md, S-1.
 *
 * Dropped rather than repaired, unlike the timestamps below: a record with no artists and
 * no sources is not a song and there is nothing to fall back to. A playlist that quietly
 * loses one entry still renders and still plays; a playlist that keeps it renders nothing
 * ever again.
 */
function usableSongs(value: unknown): Song[] {
  if (!Array.isArray(value)) return [];

  return value.filter(
    (song): song is Song =>
      typeof song === "object" &&
      song !== null &&
      typeof (song as Song).id === "string" &&
      typeof (song as Song).title === "string" &&
      Array.isArray((song as Song).artists) &&
      Array.isArray((song as Song).sources),
  );
}

function readStorage(): LocalPlaylist[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Shape-checked, not trusted: a half-valid entry would crash a render far from here.
    return parsed
      .filter(
        (item): item is LocalPlaylist =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as LocalPlaylist).id === "string" &&
          typeof (item as LocalPlaylist).name === "string" &&
          Array.isArray((item as LocalPlaylist).songs),
      )
      // The timestamps are repaired rather than required: a list with a name and songs is
      // perfectly usable, so an entry written before these existed must not be discarded.
      // But `state` sorts on `updatedAt` unconditionally, so a missing one threw on read.
      // Falling back to `createdAt` keeps whatever ordering the file does carry.
      .map((playlist) => ({
        ...playlist,
        createdAt: typeof playlist.createdAt === "string" ? playlist.createdAt : "",
        updatedAt:
          typeof playlist.updatedAt === "string"
            ? playlist.updatedAt
            : typeof playlist.createdAt === "string"
              ? playlist.createdAt
              : "",
        // Storage is a trust boundary too, not just the import: whatever wrote this may
        // have been an older Timbre, a half-finished sync, or a poisoned import that got
        // in before the check above existed. Those browsers have to heal on read.
        songs: usableSongs(playlist.songs),
      }));
  } catch {
    // Corrupt JSON, or storage blocked entirely.
    return [];
  }
}

// The lazy read fills `all` as well as the snapshot, so a cross-tab write refreshes both.
// `EMPTY` is not settled, which is what marks the store unread.
const store = createLocalStore<PlaylistsState>({
  read: () => {
    all = readStorage();
    return state(null);
  },
  initial: EMPTY,
  keys: [KEY],
});

/** Writes, then republishes. Published through `state`, so a quota message survives: dropping
 * it for a hard-coded `null` here made running out of storage look exactly like a successful
 * save until the next reload. */
function persist(): void {
  // Built **before** the write, not after. `state` summarises every playlist, so it is the
  // step that discovers a record it cannot read — and doing that after `setItem` meant a
  // throw left storage holding something no later load could parse, turning one bad write
  // into a permanent one. Computing first makes the failure cost only the change.
  const next = state(null);

  try {
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Quota. Reported, not swallowed: the change is in memory but will not survive a reload.
    store.publish(state("Out of browser storage. Remove a playlist, or a profile picture."));
    return;
  }
  store.publish(next);
}

/** Reads storage once, on mount — the first read cannot happen during render, because the
 * server has no localStorage. */
export const loadPlaylists = store.load;

export function usePlaylists(): PlaylistsState {
  return useLocalStore(store);
}

/** One playlist in full, or null. Returns songs, unlike the summaries. */
export function usePlaylist(id: string): LocalPlaylist | null {
  // Subscribed through the same store so a rename repaints here too; the lookup itself is
  // against the live array rather than the snapshot.
  usePlaylists();
  return all.find((playlist) => playlist.id === id) ?? null;
}

function touch(playlist: LocalPlaylist): void {
  playlist.updatedAt = new Date().toISOString();
}

export function createPlaylist(name: string): PlaylistSummary {
  const now = new Date().toISOString();
  const playlist: LocalPlaylist = {
    id: crypto.randomUUID(),
    name: name.trim(),
    createdAt: now,
    updatedAt: now,
    songs: [],
  };

  all = [playlist, ...all];
  persist();
  return summarise(playlist);
}

export function renamePlaylist(id: string, name: string): void {
  const playlist = all.find((item) => item.id === id);
  if (!playlist) return;
  playlist.name = name.trim();
  touch(playlist);
  persist();
}

export function deletePlaylist(id: string): void {
  all = all.filter((playlist) => playlist.id !== id);
  persist();
}

/** Appends a song. A repeat is allowed — refusing one is an editorial decision. */
export function addSongToPlaylist(id: string, song: Song): void {
  const playlist = all.find((item) => item.id === id);
  if (!playlist) return;
  playlist.songs = [...playlist.songs, song];
  touch(playlist);
  persist();
}

/** Removes by position, not by song, so a repeat removes the one clicked. */
export function removeSongAt(id: string, position: number): void {
  const playlist = all.find((item) => item.id === id);
  if (!playlist || position < 0 || position >= playlist.songs.length) return;
  playlist.songs = playlist.songs.filter((_, index) => index !== position);
  touch(playlist);
  persist();
}

/** Moves one entry, closing the gap behind it. */
export function moveSong(id: string, from: number, to: number): void {
  const playlist = all.find((item) => item.id === id);
  if (!playlist) return;

  const last = playlist.songs.length - 1;
  if (from < 0 || from > last || to < 0 || to > last || from === to) return;

  const next = [...playlist.songs];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  playlist.songs = next;
  touch(playlist);
  persist();
}

// Moving between devices

/** Everything, as a file — the only way to move a library to another machine or survive
 * clearing site data. Versioned so a format change can still read it. */
export interface PlaylistExport {
  format: "timbre.playlists";
  version: 1;
  exportedAt: string;
  playlists: LocalPlaylist[];
}

export function exportPlaylists(): PlaylistExport {
  return {
    format: "timbre.playlists",
    version: 1,
    exportedAt: new Date().toISOString(),
    playlists: all,
  };
}

export class ImportError extends Error {}

/** Merges an exported file back in, returning how many arrived. Merge rather than replace,
 * with new ids: importing must never silently overwrite what is already here. */
export function importPlaylists(data: unknown): number {
  const file = data as Partial<PlaylistExport>;
  if (!file || file.format !== "timbre.playlists" || !Array.isArray(file.playlists)) {
    throw new ImportError("That isn't a Timbre playlist export.");
  }

  const incoming = file.playlists.filter(
    (playlist): playlist is LocalPlaylist =>
      typeof playlist?.name === "string" && Array.isArray(playlist?.songs),
  );

  if (incoming.length === 0) throw new ImportError("That file has no playlists in it.");

  const now = new Date().toISOString();
  all = [
    ...incoming.map((playlist) => ({
      ...playlist,
      id: crypto.randomUUID(),
      // Typed, not just defaulted: `?? now` accepted an object here, which then sorted
      // against a string in `state`.
      createdAt: typeof playlist.createdAt === "string" ? playlist.createdAt : now,
      updatedAt: now,
      // The file came from outside Timbre and is the least trustworthy input the app has.
      songs: usableSongs(playlist.songs),
    })),
    ...all,
  ];
  persist();

  return incoming.length;
}
