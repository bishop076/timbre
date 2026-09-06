"use client";

import { useSyncExternalStore } from "react";

import { usableSongs } from "./song-shape.ts";
import type { SongsResponse } from "./types";

// The last charts this browser saw, so a reload opens on real songs rather than grey
// placeholders while `/api/charts` answers. Nothing here decides when to refetch: the fetch
// happens on mount regardless and overwrites this.

const KEY = "timbre:charts";

let snapshot: SongsResponse | null = null;
let read = false;

/** Nothing outside this module changes it while a page is open. */
function subscribe(): () => void {
  return () => {};
}

/** The cached charts as they will be read, or null on a first visit. Exported for the tests. */
export function readCachedCharts(): SongsResponse | null {
  if (!read) {
    read = true;
    try {
      const raw = window.localStorage.getItem(KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      // Shape-checked, not trusted: user-editable storage, and a malformed entry crashes
      // a shelf — during render, before the fetch that would overwrite it has run, so it
      // came back on every visit and the only way out was "Reset stored data". Same
      // class as docs/SECURITY.md S-1, one store over.
      const songs = (parsed as SongsResponse | null)?.songs;
      if (Array.isArray(songs)) snapshot = { songs: usableSongs(songs), failures: [] };
    } catch {
      // Corrupt JSON, or storage blocked. A first visit looks the same.
    }
  }
  return snapshot;
}

function getServerSnapshot(): SongsResponse | null {
  return null;
}

/** The cached charts, or null on a first visit. */
export function useCachedCharts(): SongsResponse | null {
  return useSyncExternalStore(subscribe, readCachedCharts, getServerSnapshot);
}

/** Records the charts just fetched — only the songs. The `failures` array describes *this*
 * request, so replaying it reports a source down long after it came back. */
export function rememberCharts(response: SongsResponse): void {
  // Checked on the way in as well as on the way out, so one bad row from upstream is never
  // written to a place it would be read back from on every later load.
  const songs = usableSongs(response.songs);
  snapshot = { ...response, songs };
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ songs }));
  } catch {
    // Out of quota. Playlists and pictures matter more than a chart cache.
  }
}
