"use client";

import { createLocalStore, useLocalStore } from "./local-store.ts";

const store = createLocalStore({ initial: "" });

export function setSearchQuery(next: string): void {
  if (next !== store.getSnapshot()) store.publish(next);
}

export function useSearchQuery(): string {
  return useLocalStore(store);
}
