"use client";

/**
 * Who you are, in this browser.
 *
 * There is no account. Timbre asks for no email, sends no sign-in link, and
 * keeps no user record — so "your profile" is a display name and a couple of
 * pictures held locally, and the whole thing costs nothing to host and exposes
 * nobody's personal data.
 *
 * The **id** is the load-bearing part. It seeds the avatar's colour and keys the
 * stored pictures, so it has to be stable for as long as the browser keeps its
 * data. It is generated once, never sent anywhere, and identifies nothing
 * outside this machine — closer to a theme preference than to a user id.
 */

import { useSyncExternalStore } from "react";

export interface LocalProfile {
  id: string;
  name: string | null;
}

const ID_KEY = "timbre:profile-id";
const NAME_KEY = "timbre:profile-name";

/**
 * Referentially stable, and what hydration renders against.
 *
 * The id is empty rather than random: the server must render *something*, and
 * a random one would differ from the browser's on the very first paint.
 * Consumers treat an empty id as "not loaded yet".
 */
const EMPTY: LocalProfile = { id: "", name: null };

let snapshot: LocalProfile = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function read(): LocalProfile {
  try {
    let id = window.localStorage.getItem(ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(ID_KEY, id);
    }
    return { id, name: window.localStorage.getItem(NAME_KEY) };
  } catch {
    // Storage blocked. A per-session id still gives a stable avatar colour for
    // as long as the tab is open, which is the best available answer.
    return { id: "local", name: null };
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): LocalProfile {
  if (!loaded) {
    loaded = true;
    snapshot = read();
  }
  return snapshot;
}

function getServerSnapshot(): LocalProfile {
  return EMPTY;
}

export function useLocalProfile(): LocalProfile {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Sets the display name. Empty clears it, since "no name" is a real state. */
export function setDisplayName(name: string): void {
  const trimmed = name.trim();
  try {
    if (trimmed) window.localStorage.setItem(NAME_KEY, trimmed);
    else window.localStorage.removeItem(NAME_KEY);
  } catch {
    // Not being able to remember it is no reason to refuse to change it.
  }
  snapshot = { ...getSnapshot(), name: trimmed || null };
  emit();
}
