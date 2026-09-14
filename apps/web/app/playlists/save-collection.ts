"use client";

import { usableSongs } from "../song-shape.ts";
import type { Song } from "../types";
import { addSongsToPlaylist, createPlaylist } from "./store.ts";

export function saveAsPlaylist(name: string, tracks: readonly Song[], coverUrl?: string | null) {
  const songs = usableSongs(tracks).filter((song) => song.sources.length > 0);
  if (songs.length === 0) return null;

  // The list's own picture, where it has one — Spotify and YouTube Music both give their
  // playlists art that says more than four song covers in a grid ever will. Dropped by
  // `createPlaylist` unless `/api/art` will serve it.
  const playlist = createPlaylist(name.trim().slice(0, 120) || "Untitled playlist", coverUrl);
  addSongsToPlaylist(playlist.id, songs);
  return { playlist, saved: songs.length };
}
