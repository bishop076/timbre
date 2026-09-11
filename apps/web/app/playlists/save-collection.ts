"use client";

/**
 * A whole list saved as a playlist in one press — an album, a station's draw, a pasted
 * Spotify or YouTube playlist. Built from the store's own `createPlaylist` and
 * `addSongsToPlaylist`, so whatever those promise about what is stored holds here too.
 */

import { usableSongs } from "../song-shape.ts";
import type { Song } from "../types";
import { addSongsToPlaylist, createPlaylist, type PlaylistSummary } from "./store.ts";

/** The longest name the store's own "New playlist…" field accepts. */
const NAME_MAX = 120;

/**
 * A collection's songs as a playlist should hold them.
 *
 * Reduced to `Song`'s own fields. A collection's rows are chart tracks, carrying a position
 * and a popularity score that mean something on the page they came from and nothing in a
 * playlist — stored, they would ride along in every export forever. `from` goes for the
 * reason `addSongsToPlaylist` gives, and is dropped here as well so this does not depend on it.
 *
 * A song with no source at all is left out: there is nothing to play and nothing to search
 * with that a later press could use. Link-only songs stay — the player finds a copy for those
 * from a playlist exactly as it does from the page they were saved from.
 */
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

/**
 * Creates a playlist named `name` holding every song in `tracks` that can be saved, in order.
 * Null when there was nothing to save, so no empty playlist is left behind. Two writes, not
 * one per song: each write is the whole library, and a hundred of them took 1.9s against a
 * large one.
 */
export function saveAsPlaylist(
  name: string,
  tracks: readonly Song[],
): { playlist: PlaylistSummary; saved: number } | null {
  const songs = songsToSave(tracks);
  if (songs.length === 0) return null;

  // The store reads itself before any write (`held` in store.ts), so this cannot replace a
  // library nothing on the page had loaded yet.
  const playlist = createPlaylist(name.trim().slice(0, NAME_MAX) || "Untitled playlist");
  addSongsToPlaylist(playlist.id, songs);
  return { playlist, saved: songs.length };
}
