"use client";

/**
 * Playlists, in the browser — no database, no accounts, no personal data. The cost, stated
 * wherever these appear: clearing site data loses them and they do not follow you to
 * another device, which is why export is a first-class feature. A playlist stores whole
 * songs, not references, so a saved list renders and plays with no network at all.
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

/** Republishes, most recently touched first. `error` is a parameter rather than hard-coded
 * `null`, which silently undid the quota message `persist` had just set — running out of
 * storage looked exactly like success until the next reload. */
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
    // Quota. Reported, not swallowed: the change is in memory but will not survive a reload.
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
    // Shape-checked, not trusted: a half-valid entry would crash a render far from here.
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
  /* Read here rather than from an effect: the read is synchronous, but from `useEffect` it
   * lands after the first paint, so the library painted an empty grid first. It happens
   * once and every later call returns the identical object, which is
   * `useSyncExternalStore`'s stability contract. No `publish()` — notifying React while it
   * asks for a snapshot is a render-phase side effect. */
  if (!snapshot.settled) {
    all = readStorage();
    snapshot = {
      playlists: [...all]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(summarise),
      settled: true,
      error: null,
    };
  }
  return snapshot;
}

function getServerSnapshot(): PlaylistsState {
  return EMPTY;
}

/** Reads storage once, on mount — the first read cannot happen during render, because the
 * server has no localStorage. */
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
      createdAt: playlist.createdAt ?? now,
      updatedAt: now,
    })),
    ...all,
  ];
  persist();

  return incoming.length;
}
