"use client";

import { usableSongs } from "../song-shape.ts";
import type { Song } from "../types";
import { addSongsToPlaylist, createPlaylist } from "./store.ts";

export function saveAsPlaylist(name: string, tracks: readonly Song[]) {
  const songs = usableSongs(tracks).filter((song) => song.sources.length > 0);
  if (songs.length === 0) return null;

  const playlist = createPlaylist(name.trim().slice(0, 120) || "Untitled playlist");
  addSongsToPlaylist(playlist.id, songs);
  return { playlist, saved: songs.length };
}
