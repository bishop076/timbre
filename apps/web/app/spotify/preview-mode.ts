"use client";

import { createNotifier } from "../local-store.ts";

const KEY = "timbre:spotify:previews-only";

const notifier = createNotifier();
let snapshot = false;

function read(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberSpotifyPreviewsOnly(): void {
  if (snapshot) return;
  snapshot = true;
  try {
    window.sessionStorage.setItem(KEY, "1");
  } catch {
  }
  notifier.emit();
}

export function spotifyPreviewsOnly(): boolean {
  if (!snapshot) snapshot = read();
  return snapshot;
}

export function openSpotifyWindow(trackId: string): void {
  window.open(
    `https://open.spotify.com/embed/track/${encodeURIComponent(trackId)}`,
    "timbre-spotify",
    "width=420,height=560,noopener",
  );
}

export const subscribeSpotifyPreviewMode = notifier.subscribe;
