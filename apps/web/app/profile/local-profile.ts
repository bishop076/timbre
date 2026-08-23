"use client";

// Who you are in this browser: a display name and a couple of pictures, no account. The
// id seeds the avatar's colour, so it stays stable for as long as the browser keeps its
// data. Generated once, never sent anywhere.

import { createLocalStore, useLocalStore } from "../local-store.ts";

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

function readStorage(): LocalProfile {
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

/** Every read records the monogram, so a cross-tab rename updates it too — not only the
 * first read. */
function read(): LocalProfile {
  const profile = readStorage();
  recordMonogram(profile);
  return profile;
}

// Both keys are followed: another tab renamed the profile, and without that a rename left
// other tabs on the old name, then wrote from one of them against a stale snapshot.
const store = createLocalStore<LocalProfile>({
  read,
  initial: EMPTY,
  keys: [ID_KEY, NAME_KEY],
  onFirstRead: (profile) => {
    // Backfilled for anyone named before the cookie existed, on the first read so it is
    // written before the next navigation asks for HTML.
    if (profile.name && !document.cookie.includes(`${NAME_COOKIE}=`)) {
      writeNameCookie(profile.name);
    }
  },
});

export function useLocalProfile(): LocalProfile {
  return useLocalStore(store);
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
    // `Secure` keeps it off plain HTTP and stops a non-secure origin on the same host from
    // writing it. Local development is unaffected: browsers treat localhost and 127.0.0.1
    // as secure contexts, so a Secure cookie is set there over http as normal.
    document.cookie = `${NAME_COOKIE}=${value};path=/;max-age=${age};SameSite=Lax;Secure`;
  } catch {
    // Cookies disabled. The page falls back to filling the name in after load.
  }
}

// Control characters, out. The name lands in a cookie and in a CSS string in the boot
// script, and neither has a sane reading of one. Stripped once rather than escaped at
// each of the three destinations.
const CONTROL = /[\u0000-\u001f\u007f]/g;

/**
 * A ceiling on the name, for the same reason the control characters go: it is written to a
 * cookie, and `path=/` means that cookie rides on **every** request to the origin —
 * including each `/api/art` fetch, of which one Explore page makes about thirty.
 *
 * Nothing enforced a length, so a pasted wall of text became kilobytes on the hot path,
 * permanently, with nothing to notice it by. 64 is past any real display name and far under
 * the ~4KB a browser will carry, so the cap is invisible to everyone it is not protecting.
 *
 * Truncated rather than refused: this runs as the name editor is used, and rejecting the
 * change outright would freeze the field mid-word.
 */
const MAX_NAME_LENGTH = 64;

/** Sets the display name. Empty clears it, since "no name" is a real state. */
export function setDisplayName(name: string): void {
  // Trimmed again after slicing, or a cut landing on a space stores a trailing one.
  const trimmed = name.replace(CONTROL, "").trim().slice(0, MAX_NAME_LENGTH).trim();
  try {
    if (trimmed) window.localStorage.setItem(NAME_KEY, trimmed);
    else window.localStorage.removeItem(NAME_KEY);
  } catch {
    // Not being able to remember it is no reason to refuse to change it.
  }
  writeNameCookie(trimmed || null);
  // Published rather than saved: the keys are written above, one of them by removal.
  const next = { ...store.getSnapshot(), name: trimmed || null };
  recordMonogram(next);
  store.publish(next);
}
