"use client";

import { useSyncExternalStore } from "react";

import { usableSongs } from "./song-shape.ts";
import type { SongsResponse } from "./types";

const KEY = "timbre:charts";

let snapshot: SongsResponse | null = null;
let read = false;

function subscribe(): () => void {
  return () => {};
}

export function readCachedCharts(): SongsResponse | null {
  if (!read) {
    read = true;
    try {
      const raw = window.localStorage.getItem(KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      const songs = (parsed as SongsResponse | null)?.songs;
      if (Array.isArray(songs)) snapshot = { songs: usableSongs(songs), failures: [] };
    } catch {
    }
  }
  return snapshot;
}

function getServerSnapshot(): SongsResponse | null {
  return null;
}

export function useCachedCharts(): SongsResponse | null {
  return useSyncExternalStore(subscribe, readCachedCharts, getServerSnapshot);
}

export function rememberCharts(response: SongsResponse): void {
  const songs = usableSongs(response.songs);
  snapshot = { ...response, songs };
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ songs }));
  } catch {
  }
}
