"use client";

import { useSyncExternalStore } from "react";

/*
 * Whether this render can read the browser's storage. The server cannot, so its render is
 * the empty guess — a stranger's page for a moment on every reload — and components use
 * this to decline to guess. `useSyncExternalStore` gives two snapshots, one per
 * environment, without the extra render pass a `useState` + `useEffect` flag costs.
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

/** False on the server and through hydration, true once storage is readable. */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, onClient, onServer);
}
