"use client";

import { useSyncExternalStore } from "react";

/**
 * What is currently being searched for.
 *
 * The field itself lives in the app shell, above the routed page, so that it
 * survives navigation — typing on Home moves you to the results without the
 * input ever unmounting, which is what keeps the caret and the next keystroke
 * from being lost mid-word. A component that outlives the page it drives cannot
 * hold that page's state, so the query lives here instead and both read it.
 *
 * Deliberately **not** in the URL. A `?q=` would have to be kept in step with
 * this in both directions — typing writes the URL, Back writes the field — and
 * every version of that dance has a race in it. The cost is that a reload
 * clears the search, which is a fair trade for a box that is one keystroke away
 * on every page. Module state survives client-side navigation, so leaving a
 * result and coming back still shows it.
 *
 * Same `useSyncExternalStore` shape as `volume-store` and `history-store`. The
 * server snapshot is the empty string, which is also the client's starting
 * value, so there is nothing for hydration to disagree about.
 */

let query = "";
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): string {
  return query;
}

function getServerSnapshot(): string {
  return "";
}

export function setSearchQuery(next: string): void {
  if (next === query) return;
  query = next;
  for (const listener of listeners) listener();
}

export function useSearchQuery(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
