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

import { monogram } from "./avatar";

export interface LocalProfile {
  id: string;
  name: string | null;
}

const ID_KEY = "timbre:profile-id";
const NAME_KEY = "timbre:profile-name";

/**
 * How the monogram looked last time, for the boot script to replay.
 *
 * The initial and the gradient are both derived from values only
 * `localStorage` holds, so the first paint cannot compute them — and a first
 * paint that draws a grey disc, then a coloured one with a letter in it, is
 * two states for something that never changed. Recorded here as finished
 * strings and read back by `layout.tsx`, which is the same arrangement
 * `timbre:palette` already uses and for the same reason: replaying a recorded
 * result cannot drift from the code that produced it, and re-deriving it in an
 * inline script would.
 */
const MONO_KEY = "timbre:avatar-mono";

function recordMonogram(profile: LocalProfile): void {
  try {
    if (!profile.id) return;
    // The same fallback the sidebar passes, so the recorded letter is the one
    // that will actually be rendered a moment later.
    window.localStorage.setItem(MONO_KEY, JSON.stringify(monogram(profile.id, profile.name, "Profile")));
  } catch {
    // Storage unavailable. The first paint simply starts from a plain disc.
  }
}

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

/**
 * Another tab renamed the profile; follow it rather than diverging.
 *
 * Every other local store here does this — the theme, the playlists, the
 * history — and this one did not, so a rename in one tab left every other tab
 * showing the old name for as long as it stayed open, and the next write from
 * either of them was made against a stale snapshot.
 */
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
    /*
     * Backfilled for anyone who named themselves before the cookie existed.
     *
     * Without this the cookie would only appear for people who happen to rename
     * themselves afterwards, so everybody already using Timbre would keep
     * seeing the guest frame — a fix nobody receives is not a fix. Written on
     * the first read rather than in an effect so it is done by the time the next
     * navigation asks for HTML.
     */
    if (snapshot.name && !document.cookie.includes(`${NAME_COOKIE}=`)) {
      writeNameCookie(snapshot.name);
    }
    // Likewise for the monogram: recorded on every first read, so a browser
    // that had a profile before this existed gets the flicker-free first paint
    // on its *next* load rather than only after a rename.
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

/** Sets the display name. Empty clears it, since "no name" is a real state. */
/**
 * The name, in a cookie as well as in storage.
 *
 * **This is the one thing that lets the server render the right page.** The
 * markup is generated on a machine that cannot see `localStorage`, so it always
 * rendered the empty profile — and every reload showed a stranger called
 * "Profile" for a frame before the real name replaced it. A cookie is the only
 * local value the browser volunteers *with the request*, so it is the only one
 * the first byte of HTML can contain.
 *
 * It does not weaken "nothing lives on the server": the server never stores
 * this. The browser states it, the server uses it for one render, and it is
 * gone. `SameSite=Lax` so it is not sent on cross-site requests, and a year so
 * it outlives the session it describes.
 *
 * Only the name. Not the pictures — a thumbnail would be kilobytes on every
 * request including every image and API call, to save one frame of a monogram.
 */
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

/**
 * Control characters, out.
 *
 * A display name is one line of text and the field enforces that for typing —
 * but this value is also written into a cookie and into a CSS string in the
 * boot script, and neither has a sane reading of a stray control character pasted in
 * from somewhere else. Stripped once, here, rather than escaped separately at
 * each of the three places it lands.
 */
const CONTROL = /[\u0000-\u001f\u007f]/g;

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
