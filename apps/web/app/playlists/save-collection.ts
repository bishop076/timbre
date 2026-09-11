"use client";

import { usableSongs } from "../song-shape.ts";
import type { Song } from "../types";
import { addSongsToPlaylist, createPlaylist, type PlaylistSummary } from "./store.ts";

const NAME_MAX = 120;

export function songsToSave(tracks: readonly Song[]): Song[] {
  return usableSongs(tracks)
    .filter((song) => song.sources.length > 0)
    .map((song) => ({
      id: song.id,
      title: song.title,
      artists: song.artists,
      album: song.album,
      durationMs: song.durationMs,
      isrc: song.isrc,
      artworkUrl: song.artworkUrl,
      ...(song.artworkFallbacks ? { artworkFallbacks: song.artworkFallbacks } : {}),
      sources: song.sources.map(({ source, sourceId, url, playback, previewUrl }) => ({
        source,
        sourceId,
        url,
        playback,
        ...(previewUrl ? { previewUrl } : {}),
      })),
    }));
}

export function saveAsPlaylist(
  name: string,
  tracks: readonly Song[],
): { playlist: PlaylistSummary; saved: number } | null {
  const songs = songsToSave(tracks);
  if (songs.length === 0) return null;

  const playlist = createPlaylist(name.trim().slice(0, NAME_MAX) || "Untitled playlist");
  addSongsToPlaylist(playlist.id, songs);
  return { playlist, saved: songs.length };
}
