"use client";

import { createJsonStore, useLocalStore } from "../local-store.ts";
import type { SpotifyTokens } from "./pkce.ts";

const store = createJsonStore<SpotifyTokens | null>("timbre:spotify", null, (stored) => {
  const value = stored as Partial<SpotifyTokens>;
  return typeof value.accessToken === "string" && typeof value.expiresAt === "number"
    ? (value as SpotifyTokens)
    : null;
});

/**
 * Whether the last connection ended because Spotify rejected it rather than because the reader
 * pressed Disconnect. Both leave the token store empty, and the panel has very different things
 * to say about the two — "connect an account" against "your account is still fine, the saved
 * grant is not". Kept beside the tokens rather than inside them so nothing that reads
 * `SpotifyTokens` has to know it exists.
 */
const lapsed = createJsonStore<boolean>("timbre:spotify:lapsed", false, (stored) => stored === true);

export const getSpotifyTokens = store.getSnapshot;

export function useSpotifyTokens(): SpotifyTokens | null {
  return useLocalStore(store);
}

export function useSpotifyLapsed(): boolean {
  return useLocalStore(lapsed);
}

export function saveSpotifyTokens(tokens: SpotifyTokens): void {
  lapsed.save(false);
  store.save(tokens);
}

export function disconnectSpotify(because: "asked" | "lapsed" = "asked"): void {
  lapsed.save(because === "lapsed");
  store.save(null);
}
