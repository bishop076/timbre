"use client";

/**
 * Whether Spotify's embed only ever gives *this browser* a thirty-second clip.
 *
 * ## Why this is remembered rather than asked each time
 *
 * The embed decides preview-versus-full on Spotify's server, from the `sp_dc` cookie on the
 * iframe request. In a third-party frame many browsers do not send it — a blocker, shields,
 * or an explicit setting — and Spotify then serves a clip to a signed-in Premium listener
 * exactly as readily as to a stranger. Nothing on this side can change that: measured, no URL
 * parameter overrides it, `requestStorageAccessFor` is Related-Website-Sets-only, and
 * Spotify's embed contains no Storage Access implementation at all.
 *
 * **But the same document, opened top-level, is first-party and plays the whole song.** That
 * is a window rather than a frame, and a window can only be opened from a user gesture — so
 * it cannot be done in response to the preview being *detected*, which happens seconds later
 * with no gesture in hand. It can only be done on the press itself.
 *
 * Hence this: the first Spotify track in a browser that blocks the cookie plays as a preview
 * and says so. That answer is remembered, and every later press of a Spotify badge goes
 * straight to the window, where the song plays in full.
 *
 * ## Session-scoped on purpose
 *
 * `sessionStorage`, not `localStorage`. The answer is a property of the browser's current
 * cookie posture, and that changes the moment someone allows third-party cookies or drops
 * their blocker for the site — which is the outcome this is meant to make unnecessary, not to
 * paper over permanently. A new tab re-learns it, and costs one preview to do so.
 */

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

/** Called once the embed has actually reported a clip for a track known to be longer. */
export function rememberSpotifyPreviewsOnly(): void {
  if (snapshot) return;
  snapshot = true;
  try {
    window.sessionStorage.setItem(KEY, "1");
  } catch {
    // Blocked storage. The memory then lasts only as long as this page, which is still
    // better than not at all.
  }
  notifier.emit();
}

/** Whether a Spotify press should go straight to a first-party window. */
export function spotifyPreviewsOnly(): boolean {
  if (!snapshot) snapshot = read();
  return snapshot;
}

/** The window that plays it in full: the same embed, top-level, so the cookie is first-party.
 *
 * Must be called synchronously from the click, or the popup blocker takes it. */
export function openSpotifyWindow(trackId: string): void {
  window.open(
    `https://open.spotify.com/embed/track/${encodeURIComponent(trackId)}`,
    "timbre-spotify",
    "width=420,height=560,noopener",
  );
}

export const subscribeSpotifyPreviewMode = notifier.subscribe;
