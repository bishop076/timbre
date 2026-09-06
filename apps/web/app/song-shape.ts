import type { Song } from "./types";

/**
 * Songs from a trust boundary, with anything that would throw downstream removed.
 *
 * `Array.isArray(songs)` used to be the entire check in every place a song could arrive
 * from storage — and nothing downstream guards a field before reading it: the sidebar
 * reads `song.artworkUrl`, the player reads `song.sources.find(…)`, every row reads
 * `song.artists.join(…)`. One `null` in the array was therefore a TypeError thrown during
 * render, on every route, and the store had already persisted it, so it came back on every
 * later load. See docs/SECURITY.md, S-1 — first in the playlists, then again in the chart
 * cache, which is why the check lives here rather than in either store.
 *
 * Dropped rather than repaired: a record with no artists and no sources is not a song and
 * there is nothing to fall back to. A list that quietly loses one entry still renders and
 * still plays; a list that keeps it renders nothing ever again.
 */
export function usableSongs(value: unknown): Song[] {
  if (!Array.isArray(value)) return [];

  return value.filter(
    (song): song is Song =>
      typeof song === "object" &&
      song !== null &&
      typeof (song as Song).id === "string" &&
      typeof (song as Song).title === "string" &&
      Array.isArray((song as Song).artists) &&
      Array.isArray((song as Song).sources),
  );
}
