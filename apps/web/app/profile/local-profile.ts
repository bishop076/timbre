"use client";

import { createLocalStore, newId, readItem, useLocalStore, writeItem, writeJson } from "../local-store.ts";

import { monogram } from "./avatar";

interface LocalProfile {
  id: string;
  name: string | null;
}

const ID_KEY = "timbre:profile-id";
const NAME_KEY = "timbre:profile-name";
const NAME_COOKIE = "timbre-name";

function recordMonogram({ id, name }: LocalProfile): void {
  writeJson("timbre:avatar-mono", monogram(id, name, "Profile"));
}

/**
 * The name first, and never at the id's expense.
 *
 * This was one `try` around both reads and the id's write, so *anything* that threw — a full
 * `localStorage` refusing the `setItem`, a browser with storage blocked, `crypto.randomUUID`
 * being undefined off a secure origin — returned `{ id: "local", name: null }` and the reader's
 * display name vanished from the heading while sitting perfectly intact one key away. The name
 * is the part there is no server copy of; the id only tints a monogram, and minting a fresh one
 * that could not be stored costs a colour. `readItem` and `writeItem` each answer for themselves,
 * so a failure in one no longer decides for the other.
 */
function readStorage(): LocalProfile {
  const name = readItem(NAME_KEY);
  const stored = readItem(ID_KEY);
  if (stored) return { id: stored, name };

  // An id that could not be stored is not this browser's id, and a monogram that changes colour
  // on every load is worse than one shared by every browser that cannot store anything.
  const id = newId();
  return { id: writeItem(ID_KEY, id) ? id : "local", name };
}

function writeNameCookie(name: string | null): void {
  try {
    const value = encodeURIComponent(name ?? "");
    const age = name ? 31_536_000 : 0;
    // `Secure` is right on https and is why E-15 added it — but a browser silently discards a
    // Secure cookie set over plain http, and localhost is exempt while a LAN address is not.
    // Self-hosting over http (which the Dockerfile and RUNNING.md both support) therefore left
    // `serverName` permanently null, so the heading rendered "Profile" and snapped to the real
    // name after hydration: exactly the flash the pre-hydration read exists to prevent. Ask the
    // page how it was served rather than assuming.
    const secure = window.location.protocol === "https:" ? ";Secure" : "";
    document.cookie = `${NAME_COOKIE}=${value};path=/;max-age=${age};SameSite=Lax${secure}`;
  } catch {}
}

const store = createLocalStore<LocalProfile>({
  read: () => {
    const profile = readStorage();
    recordMonogram(profile);
    return profile;
  },
  initial: { id: "", name: null },
  write: (profile) => {
    writeItem(NAME_KEY, profile.name);
    writeNameCookie(profile.name);
    recordMonogram(profile);
  },
  keys: [ID_KEY, NAME_KEY],
  onFirstRead: ({ name }) => {
    if (name && !document.cookie.includes(`${NAME_COOKIE}=`)) writeNameCookie(name);
  },
});

export function useLocalProfile(): LocalProfile {
  return useLocalStore(store);
}

export function getDisplayName(): string | null {
  return store.getSnapshot().name;
}

export function setDisplayName(input: string): void {
  const name = input.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 64).trim();
  store.save({ ...store.getSnapshot(), name: name || null });
}
