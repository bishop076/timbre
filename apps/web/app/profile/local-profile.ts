"use client";

import { createLocalStore, useLocalStore, writeItem, writeJson } from "../local-store.ts";

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

function readStorage(): LocalProfile {
  try {
    let id = window.localStorage.getItem(ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(ID_KEY, id);
    }
    return { id, name: window.localStorage.getItem(NAME_KEY) };
  } catch {
    return { id: "local", name: null };
  }
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
