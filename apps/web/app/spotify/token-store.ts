"use client";

import { createLocalStore, useLocalStore } from "../local-store.ts";
import type { SpotifyTokens } from "./pkce.ts";

const KEY = "timbre:spotify";

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

export function useSpotifyTokens(): SpotifyTokens | null {
  return useLocalStore(store);
}

export function saveSpotifyTokens(tokens: SpotifyTokens): void {
  store.save(tokens);
}

export function disconnectSpotify(): void {
  store.save(null);
}
