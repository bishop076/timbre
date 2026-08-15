"use client";

import { useSyncExternalStore } from "react";

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

function getSnapshot(): SongsResponse | null {
  if (!read) {
    read = true;
    try {
      const raw = window.localStorage.getItem(KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      // Shape-checked: user-editable storage, and a malformed entry crashes a shelf.
      const songs = (parsed as SongsResponse | null)?.songs;
      if (Array.isArray(songs)) snapshot = { songs, failures: [] };
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
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Records the charts just fetched — only the songs. The `failures` array describes *this*
 * request, so replaying it reports a source down long after it came back. */
export function rememberCharts(response: SongsResponse): void {
  snapshot = response;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ songs: response.songs }));
  } catch {
    // Out of quota. Playlists and pictures matter more than a chart cache.
  }
}
