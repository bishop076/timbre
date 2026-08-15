"use client";

import { useSyncExternalStore } from "react";

// What is currently being searched for. The field lives in the app shell, above the routed
// page, so it survives the navigation that typing triggers — a component that outlives the
// page it drives cannot hold that page's state. Deliberately not in the URL: a `?q=` would
// have to be kept in step in both directions, and every version of that dance has a race
// in it. A reload therefore clears the search, but module state survives navigation.

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

/** Sets the query and notifies every reader. */
export function setSearchQuery(next: string): void {
  if (next === query) return;
  query = next;
  for (const listener of listeners) listener();
}

/** The current query. Empty on the server, which is also the client's start value. */
export function useSearchQuery(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
