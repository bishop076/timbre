"use client";

import { createJsonStore, useLocalStore } from "../local-store.ts";
import type { SpotifyTokens } from "./pkce.ts";

const store = createJsonStore<SpotifyTokens | null>("timbre:spotify", null, (stored) => {
  const value = stored as Partial<SpotifyTokens>;
  return typeof value.accessToken === "string" && typeof value.expiresAt === "number"
    ? (value as SpotifyTokens)
    : null;
});

export const getSpotifyTokens = store.getSnapshot;

export function useSpotifyTokens(): SpotifyTokens | null {
  return useLocalStore(store);
}

export function saveSpotifyTokens(tokens: SpotifyTokens): void {
  store.save(tokens);
}

export function disconnectSpotify(): void {
  store.save(null);
}
