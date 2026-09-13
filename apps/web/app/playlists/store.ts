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
export const getPlaylistsState = store.getSnapshot;

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

export function addSongToPlaylist(id: string, song: Song): number {
  return addSongsToPlaylist(id, [song]);
}

/** The playlists that already hold this song, so a menu can say so before it adds a second. */
export function playlistsHolding(songId: string): Set<string> {
  const holders = new Set<string>();
  for (const playlist of held()) {
    if (playlist.songs.some((song) => song.id === songId)) holders.add(playlist.id);
  }
  return holders;
}

/**
 * Appends, skipping songs the playlist already holds and repeats inside the batch itself.
 *
 * Nothing checked membership before: `likes-store` guards with `isLikedIn`, playlists did not,
 * and the menu shows a track count rather than "already in this list" — so re-saving a song
 * you had just saved silently stored it twice. The cover collage then drew the same art four
 * times, the queue carried the duplicate (`play` only de-dupes the song it was handed), and
 * the sidebar rendered two `<li>` under one key and lit both as playing.
 */
export function addSongsToPlaylist(id: string, songs: readonly Song[]): number {
  let added = 0;
  update(id, (playlist) => {
    const known = new Set(playlist.songs.map((song) => song.id));
    const fresh: Song[] = [];
    for (const song of songs) {
      if (known.has(song.id)) continue;
      known.add(song.id);
      fresh.push({ ...song, from: undefined });
    }
    added = fresh.length;
    return fresh.length > 0 ? { songs: [...playlist.songs, ...fresh] } : null;
  });
  return added;
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

/**
 * The backup file. Version 3 adds `history` and `plays`.
 *
 * Version 2 carried playlists, the profile and liked songs and nothing else — so "Back up
 * everything … For this browser or your next one" shipped a file with no listening history
 * and no play log in it, which between them are the only data behind /stats, Recently played,
 * the search suggestions and the whole For-you system. Migrating browsers on that promise
 * lost every play count silently. `importPlaylists` still reads version 2; the new keys are
 * simply absent there.
 */
export function exportPlaylists({
  profile,
  liked,
  history,
  plays,
}: {
  profile?: ProfileExport | null;
  liked?: Song[];
  history?: unknown;
  plays?: unknown;
} = {}) {
  return {
    format: "timbre.playlists",
    version: 3,
    exportedAt: new Date().toISOString(),
    playlists: all,
    ...(profile ? { profile } : {}),
    ...(liked?.length ? { liked } : {}),
    ...(Array.isArray(history) && history.length > 0 ? { history } : {}),
    ...(plays ? { plays } : {}),
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
    const carriesSomething =
      readProfileExport(file.profile) ||
      (Array.isArray(file.liked) && file.liked.length > 0) ||
      (Array.isArray(file.history) && file.history.length > 0) ||
      Boolean(file.plays);
    if (carriesSomething) return 0;
    throw new Error("That file has no playlists in it.");
  }

  const now = new Date().toISOString();
  const existing = held();

  // Re-importing the same file used to double the whole library: every incoming playlist was
  // minted a fresh `crypto.randomUUID()` and prepended, so nothing could ever recognise a
  // playlist it already had, and there is no undo. Liked songs in the very same file *are*
  // de-duped (`likes-store.ts`), which is what made the asymmetry a surprise rather than a
  // rule. Carry the exported id across so a playlist keeps its identity between browsers, and
  // fall back to the name for files old enough not to carry one. A match merges: songs the
  // list already holds are left alone, and anything new is appended.
  const byId = new Map(existing.map((playlist) => [playlist.id, playlist]));
  const byName = new Map(existing.map((playlist) => [playlist.name.toLowerCase(), playlist]));

  const added: LocalPlaylist[] = [];
  for (const playlist of incoming) {
    const id = typeof playlist.id === "string" && playlist.id ? playlist.id.slice(0, 120) : null;
    const name = playlist.name.trim().slice(0, 120) || "Imported playlist";
    const songs = usableSongs(playlist.songs);

    const match = (id && byId.get(id)) || byName.get(name.toLowerCase());
    if (match) {
      const known = new Set(match.songs.map((song) => song.id));
      const fresh: Song[] = [];
      for (const song of songs) {
        if (known.has(song.id)) continue;
        known.add(song.id);
        fresh.push(song);
      }
      if (fresh.length > 0) {
        match.songs = [...match.songs, ...fresh];
        match.updatedAt = now;
      }
      continue;
    }

    const made: LocalPlaylist = {
      id: id && !byId.has(id) ? id : crypto.randomUUID(),
      name,
      createdAt: text(playlist.createdAt, now),
      updatedAt: now,
      songs,
    };
    byId.set(made.id, made);
    byName.set(made.name.toLowerCase(), made);
    added.push(made);
  }

  all = [...added, ...existing];
  persist();
  return incoming.length;
}
