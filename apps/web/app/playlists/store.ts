"use client";

import { createLocalStore, readJson, useLocalStore, writeJson } from "../local-store.ts";
import { readProfileExport, type ProfileExport } from "../profile/profile-file.ts";
import { usableSongs } from "../song-shape.ts";
import type { Song } from "../types";

interface LocalPlaylist {
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

interface PlaylistsState {
  playlists: PlaylistSummary[] | null;
  settled: boolean;
  error: string | null;
}

const KEY = "timbre:playlists";

let all: LocalPlaylist[] = [];

const text = (value: unknown, fallback: string) => (typeof value === "string" ? value : fallback);

function summarise(playlist: LocalPlaylist): PlaylistSummary {
  return {
    id: playlist.id,
    name: playlist.name,
    trackCount: playlist.songs.length,
    covers: playlist.songs.flatMap((song) => song.artworkUrl || []).slice(0, 4),
    updatedAt: playlist.updatedAt,
  };
}

function state(error: string | null): PlaylistsState {
  return {
    playlists: [...all].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(summarise),
    settled: true,
    error,
  };
}

const store = createLocalStore<PlaylistsState>({
  read: () => {
    const stored = readJson(KEY);
    all = (Array.isArray(stored) ? stored : [])
      .filter(
        (item): item is LocalPlaylist =>
          typeof item?.id === "string" &&
          typeof item.name === "string" &&
          Array.isArray(item.songs),
      )
      .map((playlist) => {
        const createdAt = text(playlist.createdAt, "");
        return {
          ...playlist,
          createdAt,
          updatedAt: text(playlist.updatedAt, createdAt),
          songs: usableSongs(playlist.songs),
        };
      });
    return state(null);
  },
  initial: { playlists: null, settled: false, error: null },
  keys: [KEY],
});

function persist(): void {
  const next = state(null);
  if (writeJson(KEY, all)) store.publish(next);
  else store.publish(state("Out of browser storage. Remove a playlist, or a profile picture."));
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

function update(id: string, change: (playlist: LocalPlaylist) => Partial<LocalPlaylist> | null) {
  const playlist = held().find((item) => item.id === id);
  const patch = playlist ? change(playlist) : null;
  if (!playlist || !patch) return;
  Object.assign(playlist, patch, { updatedAt: new Date().toISOString() });
  persist();
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
  update(id, () => ({ name: name.trim() }));
}

export function deletePlaylist(id: string): void {
  all = held().filter((playlist) => playlist.id !== id);
  persist();
}

export function addSongToPlaylist(id: string, song: Song): void {
  addSongsToPlaylist(id, [song]);
}

export function addSongsToPlaylist(id: string, songs: readonly Song[]): void {
  update(id, (playlist) =>
    songs.length > 0
      ? { songs: [...playlist.songs, ...songs.map((song) => ({ ...song, from: undefined }))] }
      : null,
  );
}

export function removeSongAt(id: string, position: number): void {
  update(id, ({ songs }) =>
    position >= 0 && position < songs.length
      ? { songs: songs.filter((_, index) => index !== position) }
      : null,
  );
}

export function moveSong(id: string, from: number, to: number): void {
  update(id, ({ songs }) => {
    const last = songs.length - 1;
    if (from < 0 || from > last || to < 0 || to > last || from === to) return null;
    const next = [...songs];
    next.splice(to, 0, ...next.splice(from, 1));
    return { songs: next };
  });
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

export function exportPlaylists({
  profile,
  liked,
}: { profile?: ProfileExport | null; liked?: Song[] } = {}) {
  return {
    format: "timbre.playlists",
    version: 2,
    exportedAt: new Date().toISOString(),
    playlists: all,
    ...(profile ? { profile } : {}),
    ...(liked?.length ? { liked } : {}),
  };
}

export function allPlaylists(): readonly LocalPlaylist[] {
  return all;
}

export function importPlaylists(data: unknown): number {
  const file = data as Record<string, unknown> | null;
  if (!file || file.format !== "timbre.playlists" || !Array.isArray(file.playlists)) {
    throw new Error("That isn't a Timbre playlist export.");
  }

  const incoming = file.playlists.filter(
    (playlist): playlist is LocalPlaylist =>
      typeof playlist?.name === "string" && Array.isArray(playlist.songs),
  );
  if (incoming.length === 0) {
    if (readProfileExport(file.profile) || (Array.isArray(file.liked) && file.liked.length > 0)) return 0;
    throw new Error("That file has no playlists in it.");
  }

  const now = new Date().toISOString();
  all = [
    ...incoming.map((playlist) => ({
      id: crypto.randomUUID(),
      name: playlist.name.trim().slice(0, 120) || "Imported playlist",
      createdAt: text(playlist.createdAt, now),
      updatedAt: now,
      songs: usableSongs(playlist.songs),
    })),
    ...held(),
  ];
  persist();
  return incoming.length;
}
