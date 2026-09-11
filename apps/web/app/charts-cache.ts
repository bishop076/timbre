"use client";

import { createLocalStore, readJson, useLocalStore, writeJson } from "./local-store.ts";
import { usableSongs } from "./song-shape.ts";
import type { SongsResponse } from "./types";

const KEY = "timbre:charts";

const store = createLocalStore<SongsResponse | null>({
  initial: null,
  read: () => {
    const songs = (readJson(KEY) as SongsResponse | null)?.songs;
    return Array.isArray(songs) ? { songs: usableSongs(songs), failures: [] } : null;
  },
});

export const readCachedCharts = store.getSnapshot;

export function useCachedCharts(): SongsResponse | null {
  return useLocalStore(store);
}

export function rememberCharts(response: SongsResponse): void {
  const songs = usableSongs(response.songs);
  writeJson(KEY, { songs });
  store.publish({ ...response, songs });
}
