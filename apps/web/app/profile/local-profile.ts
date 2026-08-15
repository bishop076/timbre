"use client";

// Who you are in this browser: a display name and a couple of pictures, no account. The
// id seeds the avatar's colour, so it stays stable for as long as the browser keeps its
// data. Generated once, never sent anywhere.

import { useSyncExternalStore } from "react";

import { monogram } from "./avatar";

export interface LocalProfile {
  id: string;
  name: string | null;
}

const ID_KEY = "timbre:profile-id";
const NAME_KEY = "timbre:profile-name";

// How the monogram looked last time, for the boot script to replay: the initial and
// gradient come from values only `localStorage` holds, so the first paint drew a grey disc
// first. Recorded as finished strings, since an inline script that re-derived them could
// drift from the code that produced them.
const MONO_KEY = "timbre:avatar-mono";

function recordMonogram(profile: LocalProfile): void {
  try {
    if (!profile.id) return;
    // The same fallback the sidebar passes, so the recorded letter is the real one.
    window.localStorage.setItem(MONO_KEY, JSON.stringify(monogram(profile.id, profile.name, "Profile")));
  } catch {
    // Storage unavailable. The first paint simply starts from a plain disc.
  }
}

// What hydration renders against. The id is empty rather than random, which would differ
// from the browser's on the first paint; empty means "not loaded yet".
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
    // Storage blocked. A fixed id still gives a stable avatar colour.
    return { id: "local", name: null };
  }
}

// Another tab renamed the profile; follow it. Without this a rename left other tabs on
// the old name, then wrote from one of them against a stale snapshot.
function onStorage(event: StorageEvent): void {
  if (event.key !== NAME_KEY && event.key !== ID_KEY) return;
  loaded = true;
  snapshot = read();
  recordMonogram(snapshot);
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): LocalProfile {
  if (!loaded) {
    loaded = true;
    snapshot = read();
    // Backfilled for anyone named before the cookie existed, on the first read so it is
    // written before the next navigation asks for HTML.
    if (snapshot.name && !document.cookie.includes(`${NAME_COOKIE}=`)) {
      writeNameCookie(snapshot.name);
    }
    // Likewise the monogram, so an existing profile gets it on the next load.
    recordMonogram(snapshot);
  }
  return snapshot;
}

function getServerSnapshot(): LocalProfile {
  return EMPTY;
}

export function useLocalProfile(): LocalProfile {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// The name, in a cookie as well as in storage — the one thing that lets the server render
// the right page, since it cannot see `localStorage` and every reload showed a stranger
// called "Profile" for a frame. Only the name: a thumbnail would be kilobytes on every
// request, including every image and API call.
const NAME_COOKIE = "timbre-name";

function writeNameCookie(name: string | null): void {
  try {
    const value = name ? encodeURIComponent(name) : "";
    const age = name ? 31_536_000 : 0;
    document.cookie = `${NAME_COOKIE}=${value};path=/;max-age=${age};SameSite=Lax`;
  } catch {
    // Cookies disabled. The page falls back to filling the name in after load.
  }
}

// Control characters, out. The name lands in a cookie and in a CSS string in the boot
// script, and neither has a sane reading of one. Stripped once rather than escaped at
// each of the three destinations.
const CONTROL = /[\u0000-\u001f\u007f]/g;

/** Sets the display name. Empty clears it, since "no name" is a real state. */
export function setDisplayName(name: string): void {
  const trimmed = name.replace(CONTROL, "").trim();
  try {
    if (trimmed) window.localStorage.setItem(NAME_KEY, trimmed);
    else window.localStorage.removeItem(NAME_KEY);
  } catch {
    // Not being able to remember it is no reason to refuse to change it.
  }
  writeNameCookie(trimmed || null);
  snapshot = { ...getSnapshot(), name: trimmed || null };
  recordMonogram(snapshot);
  emit();
}
