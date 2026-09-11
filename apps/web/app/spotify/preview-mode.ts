"use client";

import { readItem, writeItem } from "../local-store.ts";

const KEY = "timbre:spotify:previews-only";

let previewsOnly = false;

export function rememberSpotifyPreviewsOnly(): void {
  if (previewsOnly) return;
  previewsOnly = true;
  writeItem(KEY, "1", "sessionStorage");
}

export function spotifyPreviewsOnly(): boolean {
  previewsOnly ||= readItem(KEY, "sessionStorage") === "1";
  return previewsOnly;
}

export function openSpotifyWindow(trackId: string): void {
  window.open(
    `https://open.spotify.com/embed/track/${encodeURIComponent(trackId)}`,
    "timbre-spotify",
    "width=420,height=560,noopener",
  );
}
