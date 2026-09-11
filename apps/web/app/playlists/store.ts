"use client";

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

export interface PlaylistSummary {
  id: string;
  name: string;
  trackCount: number;
  covers: string[];
  updatedAt: string;
}

export interface PlaylistsState {
  playlists: PlaylistSummary[] | null;
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
    return parsed
      .filter(
        (item): item is LocalPlaylist =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as LocalPlaylist).id === "string" &&
          typeof (item as LocalPlaylist).name === "string" &&
          Array.isArray((item as LocalPlaylist).songs),
      )
      .map((playlist) => ({
        ...playlist,
        createdAt: typeof playlist.createdAt === "string" ? playlist.createdAt : "",
        updatedAt:
          typeof playlist.updatedAt === "string"
            ? playlist.updatedAt
            : typeof playlist.createdAt === "string"
              ? playlist.createdAt
              : "",
        songs: usableSongs(playlist.songs),
      }));
  } catch {
    return [];
  }
}

const store = createLocalStore<PlaylistsState>({
  read: () => {
    all = readStorage();
    return state(null);
  },
  initial: EMPTY,
  keys: [KEY],
});

function persist(): void {
  const next = state(null);

  try {
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    store.publish(state("Out of browser storage. Remove a playlist, or a profile picture."));
    return;
  }
  store.publish(next);
}

export const loadPlaylists = store.load;

export function usePlaylists(): PlaylistsState {
  return useLocalStore(store);
}

export function usePlaylist(id: string): LocalPlaylist | null {
  usePlaylists();
  return all.find((playlist) => playlist.id === id) ?? null;
}

function held(): LocalPlaylist[] {
  store.load();
  return all;
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

  all = [playlist, ...held()];
  persist();
  return summarise(playlist);
}

export function renamePlaylist(id: string, name: string): void {
  const playlist = held().find((item) => item.id === id);
  if (!playlist) return;
  playlist.name = name.trim();
  touch(playlist);
  persist();
}

export function deletePlaylist(id: string): void {
  all = held().filter((playlist) => playlist.id !== id);
  persist();
}

export function addSongToPlaylist(id: string, song: Song): void {
  addSongsToPlaylist(id, [song]);
}

export function addSongsToPlaylist(id: string, songs: readonly Song[]): void {
  const playlist = held().find((item) => item.id === id);
  if (!playlist || songs.length === 0) return;
  playlist.songs = [...playlist.songs, ...songs.map((song) => ({ ...song, from: undefined }))];
  touch(playlist);
  persist();
}

export function removeSongAt(id: string, position: number): void {
  const playlist = held().find((item) => item.id === id);
  if (!playlist || position < 0 || position >= playlist.songs.length) return;
  playlist.songs = playlist.songs.filter((_, index) => index !== position);
  touch(playlist);
  persist();
}

export function moveSong(id: string, from: number, to: number): void {
  const playlist = held().find((item) => item.id === id);
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

export function addSourcesToSong(songId: string, found: Song["sources"]): number {
  let changed = 0;

  for (const playlist of held()) {
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

export interface PlaylistExport {
  format: "timbre.playlists";
  version: 1 | 2;
  exportedAt: string;
  playlists: LocalPlaylist[];
  profile?: ProfileExport;
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

export function allPlaylists(): readonly LocalPlaylist[] {
  return all;
}

export class ImportError extends Error {}

const MAX_NAME = 120;

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
    ...incoming.map((playlist) => ({
      id: crypto.randomUUID(),
      name: playlist.name.trim().slice(0, MAX_NAME) || "Imported playlist",
      createdAt: typeof playlist.createdAt === "string" ? playlist.createdAt : now,
      updatedAt: now,
      songs: usableSongs(playlist.songs),
    })),
    ...held(),
  ];
  persist();

  return incoming.length;
}
