"use client";

/**
 * Playlists, in the browser. **Nothing is stored on a Timbre server.**
 *
 * This used to be a thin client over Postgres. It is not any more, and the
 * reason is deployment rather than taste: keeping playlists server-side meant
 * an always-on database, an account system to own them, and — the part that
 * actually costs money — an SMTP provider to deliver magic links. Local
 * playlists need none of those, so Timbre can be hosted for free and holds no
 * personal data at all.
 *
 * The consequence is stated plainly wherever these appear: clearing site data
 * loses them, and they do not follow you to another device. Export is the
 * escape hatch, which is why it is a first-class feature here rather than a
 * nicety.
 *
 * A playlist stores **whole songs**, not references. The normalised tables this
 * replaced existed so a match computed once could be reused across users; with
 * one browser and one person there is nobody to share a cache with, and a flat
 * copy is what lets a saved list render and play with no network at all.
 */

import { useSyncExternalStore } from "react";

import type { Song } from "../types";

export interface LocalPlaylist {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  songs: Song[];
}

/** What list views need, without carrying every song into every render. */
export interface PlaylistSummary {
  id: string;
  name: string;
  description: string | null;
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
let snapshot: PlaylistsState = EMPTY;
const listeners = new Set<() => void>();

function summarise(playlist: LocalPlaylist): PlaylistSummary {
  return {
    id: playlist.id,
    name: playlist.name,
    description: playlist.description,
    trackCount: playlist.songs.length,
    covers: playlist.songs
      .map((song) => song.artworkUrl)
      .filter((url): url is string => Boolean(url))
      .slice(0, 4),
    updatedAt: playlist.updatedAt,
  };
}

/**
 * Most recently touched first, which is the order every music app uses.
 *
 * The error is passed in rather than cleared. It used to be hard-coded to
 * `null` here, which silently undid the quota message `persist` had just set on
 * the line above — so running out of storage looked exactly like success until
 * the next reload lost the change.
 */
function publish(error: string | null = null): void {
  snapshot = {
    playlists: [...all]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(summarise),
    settled: true,
    error,
  };
  for (const listener of listeners) listener();
}

function persist(): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Quota. Reported rather than swallowed: the change is already in memory
    // and the reader needs to know it will not survive a reload.
    publish("Out of browser storage. Remove a playlist, or a profile picture.");
    return;
  }
  publish();
}

function readStorage(): LocalPlaylist[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Shape-checked rather than trusted. This is user-editable storage, and a
    // half-valid entry would crash a render far away from here.
    return parsed.filter(
      (item): item is LocalPlaylist =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as LocalPlaylist).id === "string" &&
        typeof (item as LocalPlaylist).name === "string" &&
        Array.isArray((item as LocalPlaylist).songs),
    );
  } catch {
    // Corrupt JSON, or storage blocked entirely.
    return [];
  }
}

function onStorage(event: StorageEvent): void {
  if (event.key !== KEY) return;
  all = readStorage();
  publish();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): PlaylistsState {
  return snapshot;
}

function getServerSnapshot(): PlaylistsState {
  return EMPTY;
}

/**
 * Reads storage once. Named for the shape it replaced so callers did not all
 * have to change, and still worth calling on mount: the first read cannot
 * happen during render, because the server has no localStorage.
 */
export function loadPlaylists(): void {
  if (snapshot.settled) return;
  all = readStorage();
  publish();
}

export function usePlaylists(): PlaylistsState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** One playlist in full, or null. Returns songs, unlike the summaries. */
export function usePlaylist(id: string): LocalPlaylist | null {
  // Subscribed through the same store so a rename or a reorder repaints here
  // too; the lookup itself is against the live array rather than the snapshot.
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
    description: null,
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
 * Appends a song.
 *
 * The same song twice is allowed, because a playlist that refuses a repeat is
 * making an editorial decision on someone's behalf.
 */
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

// ---------------------------------------------------------------------------
// Moving between devices
// ---------------------------------------------------------------------------

/**
 * Everything, as a file.
 *
 * Local storage means a browser is the only copy, so this is not a convenience
 * — it is the *only* way to move a library to another machine or survive
 * clearing site data. Versioned so a future format change can still read it.
 */
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

/**
 * Merges an exported file back in.
 *
 * Merge rather than replace, and new ids for everything: importing on a
 * machine that already has playlists should never silently overwrite them, and
 * re-importing the same file should be visible rather than destructive.
 */
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
      createdAt: playlist.createdAt ?? now,
      updatedAt: now,
    })),
    ...all,
  ];
  persist();

  return incoming.length;
}
