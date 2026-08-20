"use client";

/**
 * The Spotify connection, held in this browser and nowhere else.
 *
 * Mirrors `player/volume-store.ts`: `localStorage` is an external store, and reading it into
 * React state after mount is a cascading render by another name.
 *
 * **This holds a credential, so two things differ from the other stores.** It is written to
 * `localStorage` rather than memory because a connection that had to be re-granted on every
 * page load is not a connection; and it is *never* sent anywhere — no route reads it, and
 * `pkce.ts` talks to Spotify straight from the page. Disconnecting removes it outright
 * rather than marking it stale, so nothing is left behind to leak.
 */

import { createLocalStore, useLocalStore } from "../local-store.ts";
import type { SpotifyTokens } from "./pkce.ts";

const KEY = "timbre:spotify";

/** Referentially stable, and what hydration renders against. */
const NONE: SpotifyTokens | null = null;

function isTokens(value: unknown): value is SpotifyTokens {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<SpotifyTokens>;
  return typeof entry.accessToken === "string" && typeof entry.expiresAt === "number";
}

function read(): SpotifyTokens | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return NONE;
    const parsed: unknown = JSON.parse(raw);
    return isTokens(parsed) ? parsed : NONE;
  } catch {
    // Private browsing, blocked storage and malformed JSON all throw rather than return null.
    return NONE;
  }
}

const store = createLocalStore<SpotifyTokens | null>({
  read,
  initial: NONE,
  write: (next) => {
    if (next) window.localStorage.setItem(KEY, JSON.stringify(next));
    else window.localStorage.removeItem(KEY);
  },
  keys: [KEY],
});

export const getSpotifyTokens = store.getSnapshot;

/** Subscribes a component to the connection. Client-only, like the store. */
export function useSpotifyTokens(): SpotifyTokens | null {
  return useLocalStore(store);
}

export function saveSpotifyTokens(tokens: SpotifyTokens): void {
  store.save(tokens);
}

/** Forgets the connection entirely. */
export function disconnectSpotify(): void {
  store.save(null);
}
