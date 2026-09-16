"use client";

import { createLocalStore, newId, readJson, useLocalStore, writeJson } from "../local-store.ts";
import { forgetPlaylistImage } from "./playlist-image.ts";
import { readProfileExport, type ProfileExport } from "../profile/profile-file.ts";
import { usableArtwork, usableSongs } from "../song-shape.ts";
import type { Song } from "../types";

interface LocalPlaylist {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /**
   * A picture the list came with — Spotify's own playlist art, kept when the list is saved from
   * a Spotify collection. Held to `usableArtwork`, the same rule as a song's cover, so it can
   * only ever be a URL `/api/art` will proxy. An uploaded picture is not this: that lives in
   * IndexedDB under `playlist-image.ts` and wins over it.
   */
  coverUrl?: string | null;
  songs: Song[];
}

export interface PlaylistSummary {
  id: string;
  name: string;
  trackCount: number;
  covers: string[];
  coverUrl: string | null;
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
    coverUrl: playlist.coverUrl ?? null,
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
          coverUrl: usableArtwork(playlist.coverUrl),
          songs: usableSongs(playlist.songs),
        };
      });
    return state(null);
  },
  initial: { playlists: null, settled: false, error: null },
  keys: [KEY],
});

/** Publishes what is now held, and answers whether storage took it. */
function persist(): boolean {
  if (writeJson(KEY, all)) {
    store.publish(state(null));
    return true;
  }
  store.publish(state("Out of browser storage. Remove a playlist, or a profile picture."));
  return false;
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

export function createPlaylist(name: string, coverUrl?: string | null): PlaylistSummary {
  const now = new Date().toISOString();
  const playlist: LocalPlaylist = {
    id: newId(),
    name: name.trim(),
    createdAt: now,
    updatedAt: now,
    coverUrl: usableArtwork(coverUrl),
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
  // An uploaded cover lives in IndexedDB under `playlist:<id>`, not in this record, so dropping
  // the record left the picture behind — a few hundred kilobytes per deleted list, kept for ever
  // under an id nothing can name again. Nothing ever called `forgetPlaylistImage`; this is it.
  forgetPlaylistImage(id);
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

/**
 * The text of a picked file, as whatever it parses to.
 *
 * `useFilePicker` reports a thrown `Error` by its `message`, which is exactly right for the
 * refusals below — they are written to be read. `JSON.parse` throws an `Error` too, so a file
 * that was never JSON answered in V8's voice instead: picking a .txt renamed to .json put
 * `Unexpected token 'h', "this is not"... is not valid JSON` on the library page. Parse through
 * here and an unreadable file refuses in the same voice as an unrecognised one.
 */
export function readBackupFile(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("That file isn't JSON. Pick the .json file Timbre exported.");
  }
}

/**
 * What an import did, for a caller that has to describe it.
 *
 * A single count could only ever describe the half that worked. The two refusals are separate
 * numbers because they are separate things: an entry the file called a playlist that nothing
 * could read, and a song inside one that did land. Neither says what it was. The name of an
 * entry we would not parse is the one field there is no reason to trust, and a file only reaches
 * this state by hand — so there is nobody to tell who does not already know which list they
 * edited, and no reason to put their text on the library page under the word "Imported".
 */
export interface ImportSummary {
  /** Playlists that landed — new lists and merges into lists this browser already had. */
  imported: number;
  /** Entries the file called playlists that nothing could read. */
  unreadablePlaylists: number;
  /** Songs inside the playlists that did land that nothing could read. */
  unreadableSongs: number;
}

export function importPlaylists(data: unknown): ImportSummary {
  const file = data as Record<string, unknown> | null;
  if (!file || file.format !== "timbre.playlists" || !Array.isArray(file.playlists)) {
    throw new Error("That isn't a Timbre playlist export.");
  }

  const incoming = file.playlists.filter(
    (playlist): playlist is LocalPlaylist =>
      typeof playlist?.name === "string" && Array.isArray(playlist.songs),
  );
  // Everything this filter refuses left by a silent door, and the number that came back counted
  // only what survived it: a file of four playlists with three of them mangled landed one and
  // answered "Imported 1 playlist", which is true and is not the whole truth. The rest of this
  // path was made to land whole or change nothing and say which; this was the corner where it
  // still landed part and said it had landed.
  const unreadablePlaylists = file.playlists.length - incoming.length;
  if (incoming.length === 0) {
    const carriesSomething =
      readProfileExport(file.profile) ||
      (Array.isArray(file.liked) && file.liked.length > 0) ||
      (Array.isArray(file.history) && file.history.length > 0) ||
      Boolean(file.plays);
    if (carriesSomething) return { imported: 0, unreadablePlaylists, unreadableSongs: 0 };
    // "No playlists in it" is true of an empty list and false of four unreadable ones.
    throw new Error(
      unreadablePlaylists > 0
        ? "Nothing in that file could be read as a playlist."
        : "That file has no playlists in it.",
    );
  }

  const now = new Date().toISOString();
  // Copies, not the live records. A merge writes into playlists this browser already has, and
  // `persist()` answers a refused write by publishing rather than throwing — so a file too big
  // for what is left of the quota landed in memory, failed to store, and left the library
  // holding songs no file describes until the next reload took them away again. Merging into
  // copies means the swap at the foot of this function is the only moment anything changes,
  // and it happens after the write rather than before it.
  const existing = held().map((playlist) => ({ ...playlist, songs: [...playlist.songs] }));

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
  let unreadableSongs = 0;
  for (const playlist of incoming) {
    const id = typeof playlist.id === "string" && playlist.id ? playlist.id.slice(0, 120) : null;
    const name = playlist.name.trim().slice(0, 120) || "Imported playlist";
    const songs = usableSongs(playlist.songs);
    // A song goes the same way an entry above does: `usableSongs` drops what it cannot read, and
    // the playlist arrives shorter than the file described it with nothing on screen to say so.
    unreadableSongs += playlist.songs.length - songs.length;
    // `exportPlaylists` writes `all` out whole, `coverUrl` included, and the import dropped it
    // on the floor: a list saved from a Spotify collection came back from a backup with the
    // four-song collage in place of its own art, and nothing anywhere could put it back —
    // `coverUrl` is only ever set when a collection is saved. A round trip that quietly returns
    // less than it was given is the one thing a backup may not do.
    const coverUrl = usableArtwork(playlist.coverUrl);

    // A file's id is the playlist's identity; its name is not. Trying the name *as well* meant a
    // list from somebody else's export was absorbed into whichever of yours happened to share a
    // title — their three songs merged into your "Favourites", no new tile anywhere, and
    // "Imported 1 playlist" underneath to say it had worked. "Playlists only — for sending to
    // someone" is the menu item that produces those files. The name stays as the fallback for a
    // file old enough to carry no id, which is all it was ever meant to be.
    const match = id ? byId.get(id) : byName.get(name.toLowerCase());
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
      // Never over a picture this browser already has: the merge adds what is missing.
      if (coverUrl && !match.coverUrl) match.coverUrl = coverUrl;
      continue;
    }

    const made: LocalPlaylist = {
      id: id && !byId.has(id) ? id : newId(),
      name,
      createdAt: text(playlist.createdAt, now),
      updatedAt: now,
      coverUrl,
      songs,
    };
    byId.set(made.id, made);
    byName.set(made.name.toLowerCase(), made);
    added.push(made);
  }

  const before = all;
  all = [...added, ...existing];
  if (!persist()) {
    // Nothing was stored, so nothing changed — which is what the copies above are for. Half a
    // backup is a library in a state no file describes, and the caller announced "Imported 1
    // playlist" directly beneath the storage warning while it was happening.
    all = before;
    store.publish(state(null));
    throw new Error(
      "There isn't room in this browser for that file. Remove a playlist or a picture, then try again.",
    );
  }
  return { imported: incoming.length, unreadablePlaylists, unreadableSongs };
}
