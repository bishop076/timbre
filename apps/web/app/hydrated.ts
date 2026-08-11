"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether this render can read the browser's storage.
 *
 * Timbre keeps everything about a person in their own browser. The markup is
 * still generated on a server, which cannot read any of it — so the server's
 * render is a guess, and the only guess available is the empty one: no name, no
 * picture, nothing saved. For a browser that genuinely has nothing that guess is
 * correct; for one with a profile it is a stranger's page, shown for a moment on
 * every reload.
 *
 * Components use this to decline to guess. False through the server render and
 * the hydration pass, true from the first render that can read storage — and by
 * then every local source is synchronous (`local-profile`, `playlists/store`,
 * and the avatar thumbnail in `local-images`), so the first render that shows
 * anything shows all of it at once, correct.
 *
 * The cost is honest and worth stating: between the first paint and hydration
 * the profile is absent rather than wrong. Removing *both* the absence and the
 * wrongness needs the server to know who is asking, which means sending the
 * name in a cookie — the browser telling the server, not the server keeping a
 * record.
 *
 * `useSyncExternalStore` rather than a `useState` + `useEffect` flag, because
 * that is exactly what it is for: two snapshots, one per environment, with React
 * aware they differ. The effect version costs an extra render pass.
 */

/** Nothing ever changes, so nothing ever needs notifying. */
function subscribe(): () => void {
  return () => {};
}

function onClient(): boolean {
  return true;
}

function onServer(): boolean {
  return false;
}

export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, onClient, onServer);
}
