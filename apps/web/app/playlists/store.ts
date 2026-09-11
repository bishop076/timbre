"use client";

/**
 * Playlists, in the browser — no database, no accounts, no personal data. The cost, stated
 * wherever these appear: clearing site data loses them and they do not follow you to
 * another device, which is why export is a first-class feature. A playlist stores whole
 * songs, not references, so a saved list renders and plays with no network at all.
 */

import { createLocalStore, useLocalStore } from "../local-store.ts";
import { readProfileExport, type ProfileExport } from "../profile/profile-file.ts";
import { usableSongs } from "../song-shape.ts";
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

/**
 * Appends a song. A repeat is allowed — refusing one is an editorial decision.
 *
 * Without `from`: that says which page a queue was started on, and a song saved from an
 * artist's queue would otherwise count as "played from that artist" every time the playlist
 * played it, folding the playlist into the artist's tile in "Recently played".
 */
export function addSongToPlaylist(id: string, song: Song): void {
  const playlist = all.find((item) => item.id === id);
  if (!playlist) return;
  playlist.songs = [...playlist.songs, { ...song, from: undefined }];
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

/**
 * Adds the copies a rescue found to every saved entry of that song, returning how many
 * playlists changed.
 *
 * The player already repairs its *queue* when nothing a song carries will play — it
 * searches for the same recording elsewhere and adopts that (`adoptElsewhere`). A saved
 * list kept the dead entry, so the same song needed rescuing on every play, and the day the
 * search stopped finding it the list simply had a song that could not be played.
 *
 * **Added beside the originals, never swapped for them.** A rescue is also what happens
 * when YouTube turns *this connection* away — a VPN, not a dead link — and replacing the
 * sources would strip YouTube from a list for good because of one bad afternoon. Carrying
 * both costs nothing: the ladder still tries the original first, and falls to the rescued
 * copy without a search.
 *
 * Not a user edit, so `updatedAt` stays put — a repair must not reorder the library.
 */
export function addSourcesToSong(songId: string, found: Song["sources"]): number {
  store.load();
  let changed = 0;

  for (const playlist of all) {
    let touched = false;
    playlist.songs = playlist.songs.map((song) => {
      if (song.id !== songId) return song;
      const fresh = found.filter(
        (copy) => !song.sources.some((own) => own.source === copy.source && own.sourceId === copy.sourceId),
      );
      if (fresh.length === 0) return song;
      touched = true;
      return { ...song, sources: [...song.sources, ...fresh] };
    });
    if (touched) changed += 1;
  }

  if (changed > 0) persist();
  return changed;
}

// Moving between devices

/** Everything, as a file — the only way to move a library to another machine or survive
 * clearing site data. Versioned so a format change can still read it.
 *
 * Version 2 adds the profile and the liked songs, optionally: a backup carries them, a list
 * sent to a friend does not — they are the part of this file that is about a person. Version
 * 1 files still import; nothing in them changed meaning. */
export interface PlaylistExport {
  format: "timbre.playlists";
  version: 1 | 2;
  exportedAt: string;
  playlists: LocalPlaylist[];
  profile?: ProfileExport;
  /** Imported by `likes-store.ts`, which owns them and checks every one. */
  liked?: Song[];
}

export function exportPlaylists(
  extras: { profile?: ProfileExport | null; liked?: Song[] } = {},
): PlaylistExport {
  return {
    format: "timbre.playlists",
    version: 2,
    exportedAt: new Date().toISOString(),
    playlists: all,
    ...(extras.profile ? { profile: extras.profile } : {}),
    ...(extras.liked?.length ? { liked: extras.liked } : {}),
  };
}

/** Every playlist in full, for an export that is not JSON — the CSV. */
export function allPlaylists(): readonly LocalPlaylist[] {
  return all;
}

export class ImportError extends Error {}

/** The same ceiling the name field has; a file can say anything. */
const MAX_NAME = 120;

/** Merges an exported file back in, returning how many arrived. Merge rather than replace,
 * with new ids: importing must never silently overwrite what is already here. A file that
 * carries only a profile or liked songs is still an export — the caller applies those, and
 * has to ask before replacing a profile. */
export function importPlaylists(data: unknown): number {
  const file = data as Partial<PlaylistExport>;
  if (!file || file.format !== "timbre.playlists" || !Array.isArray(file.playlists)) {
    throw new ImportError("That isn't a Timbre playlist export.");
  }

  const incoming = file.playlists.filter(
    (playlist): playlist is LocalPlaylist =>
      typeof playlist?.name === "string" && Array.isArray(playlist?.songs),
  );

  if (incoming.length === 0) {
    if (readProfileExport(file.profile) || (Array.isArray(file.liked) && file.liked.length > 0)) return 0;
    throw new ImportError("That file has no playlists in it.");
  }

  const now = new Date().toISOString();
  all = [
    // Rebuilt from the fields a playlist has rather than spread: whatever else the file
    // carries would otherwise be persisted with it and re-exported for ever.
    ...incoming.map((playlist) => ({
      id: crypto.randomUUID(),
      name: playlist.name.trim().slice(0, MAX_NAME) || "Imported playlist",
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
