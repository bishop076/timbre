"use client";

import { useSyncExternalStore } from "react";

import type { SongsResponse } from "./types";

/**
 * The last charts this browser saw, so a reload has something true to show.
 *
 * Home's shelves come from `/api/charts`, which cannot be asked until the page
 * is running — so every reload showed a row of grey placeholder tiles for as
 * long as that took. Placeholders are the wrong answer here: the reader has
 * seen real charts before, they are a few kilobytes of JSON, and charts that
 * are an hour old are *still the charts*. Showing yesterday's copy while today's
 * arrives is how every app that feels instant does it.
 *
 * Written after each successful fetch and read synchronously on the first client
 * render, the same shape as `theme-store`, `local-profile` and
 * `playlists/store`. Nothing here decides *when* to refetch: the fetch happens
 * unconditionally on mount and simply overwrites this, so a stale copy can only
 * ever be on screen for as long as the request takes.
 */

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
      // Shape-checked rather than trusted: this is user-editable storage, and a
      // malformed entry would crash a shelf rather than skip it.
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

/**
 * Records the charts just fetched.
 *
 * Only the songs, and not the `failures` array: that describes *this* request,
 * so replaying it on the next load would report a source as down long after it
 * came back.
 */
export function rememberCharts(response: SongsResponse): void {
  snapshot = response;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ songs: response.songs }));
  } catch {
    // Out of quota. Playlists and pictures matter more than a chart cache.
  }
}
