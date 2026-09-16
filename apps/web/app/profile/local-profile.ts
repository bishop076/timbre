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
    // `Secure` is right on https and is why it is set — but a browser silently discards a
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
  /**
   * The name, and then the two paintings of it — in that order, and only if it landed.
   *
   * The cookie is not a second copy of the name: it is what `profile/page.tsx` renders the
   * heading from on the server, before any of this has run. Writing it for a name `localStorage`
   * refused left the two disagreeing about what the reader is called, so the next load came back
   * saying the new name and replaced it with the old one a frame later — the exact flash the
   * pre-hydration read exists to prevent, caused by it. The monogram is the same kind of thing:
   * it is replayed before paint, and should describe the stored name rather than a refused one.
   */
  write: (profile) => {
    if (!writeItem(NAME_KEY, profile.name)) return false;
    writeNameCookie(profile.name);
    recordMonogram(profile);
    return true;
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

/** Saves the name, and answers whether this browser took it. False means nothing changed. */
export function setDisplayName(input: string): boolean {
  const name = input.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 64).trim();
  const previous = store.getSnapshot();
  if (store.save({ ...previous, name: name || null })) return true;

  // Refused. `save` publishes either way, which is right for a preference that is still live in
  // this tab — but a display name is not that: it is rendered from the cookie on the next load,
  // and the cookie did not move. Publishing it would put a name in the heading that exists only
  // until the page is reloaded, and say nothing about it. Put the stored one back, and let the
  // caller tell the reader.
  store.publish(previous);
  return false;
}
