"use client";

export function openSpotifyWindow(trackId: string): void {
  window.open(
    `https://open.spotify.com/embed/track/${encodeURIComponent(trackId)}`,
    "timbre-spotify",
    "width=420,height=560,noopener",
  );
}
