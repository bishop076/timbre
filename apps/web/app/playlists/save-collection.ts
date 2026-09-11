"use client";

/**
 * A whole list saved as a playlist in one press — an album, a station's draw, a pasted
 * Spotify or YouTube playlist. Built from the store's own `createPlaylist` and
 * `addSongToPlaylist`, so whatever those promise about what is stored holds here too.
 */

import { usableSongs } from "../song-shape.ts";
import type { Song } from "../types";
import { addSongToPlaylist, createPlaylist, loadPlaylists, type PlaylistSummary } from "./store.ts";

/** The longest name the store's own "New playlist…" field accepts. */
const NAME_MAX = 120;

/**
 * A collection's songs as a playlist should hold them.
 *
 * Reduced to `Song`'s own fields. A collection's rows are chart tracks, carrying a position
 * and a popularity score that mean something on the page they came from and nothing in a
 * playlist — stored, they would ride along in every export forever. `from` goes for the
 * reason `addSongToPlaylist` gives, and is dropped here as well so this does not depend on it.
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
 * Null when there was nothing to save, so no empty playlist is left behind.
 *
 * One write per song, since that is what `addSongToPlaylist` does — and each write is the whole
 * library, not the song. Measured under Node against a 1.2 MB library (thirty playlists of a
 * hundred): saving a hundred songs took 1.9s. A small library does not notice; a large one
 * will, and the cure is a bulk add in the store that persists once.
 */
export function saveAsPlaylist(
  name: string,
  tracks: readonly Song[],
): { playlist: PlaylistSummary; saved: number } | null {
  const songs = songsToSave(tracks);
  if (songs.length === 0) return null;

  // Read before the first write, not assumed read. The store fills its list lazily, and
  // `createPlaylist` writes that list back whole — so on a page where nothing had read it yet,
  // the new playlist would replace every one already saved. The sidebar happens to read it on
  // every page today; losing someone's library must not hinge on the sidebar.
  loadPlaylists();

  const playlist = createPlaylist(name.trim().slice(0, NAME_MAX) || "Untitled playlist");
  for (const song of songs) addSongToPlaylist(playlist.id, song);
  return { playlist, saved: songs.length };
}
