"use client";

import { createLocalStore, useLocalStore } from "../local-store.ts";

import { monogram } from "./avatar";

export interface LocalProfile {
  id: string;
  name: string | null;
}

const ID_KEY = "timbre:profile-id";
const NAME_KEY = "timbre:profile-name";

const MONO_KEY = "timbre:avatar-mono";

function recordMonogram(profile: LocalProfile): void {
  try {
    if (!profile.id) return;
    window.localStorage.setItem(MONO_KEY, JSON.stringify(monogram(profile.id, profile.name, "Profile")));
  } catch {
  }
}

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
    return { id: "local", name: null };
  }
}

function read(): LocalProfile {
  const profile = readStorage();
  recordMonogram(profile);
  return profile;
}

const store = createLocalStore<LocalProfile>({
  read,
  initial: EMPTY,
  keys: [ID_KEY, NAME_KEY],
  onFirstRead: (profile) => {
    if (profile.name && !document.cookie.includes(`${NAME_COOKIE}=`)) {
      writeNameCookie(profile.name);
    }
  },
});

export function useLocalProfile(): LocalProfile {
  return useLocalStore(store);
}

export function getDisplayName(): string | null {
  return store.getSnapshot().name;
}

const NAME_COOKIE = "timbre-name";

function writeNameCookie(name: string | null): void {
  try {
    const value = name ? encodeURIComponent(name) : "";
    const age = name ? 31_536_000 : 0;
    document.cookie = `${NAME_COOKIE}=${value};path=/;max-age=${age};SameSite=Lax;Secure`;
  } catch {
  }
}

const CONTROL = /[\u0000-\u001f\u007f]/g;

const MAX_NAME_LENGTH = 64;

export function setDisplayName(name: string): void {
  const trimmed = name.replace(CONTROL, "").trim().slice(0, MAX_NAME_LENGTH).trim();
  try {
    if (trimmed) window.localStorage.setItem(NAME_KEY, trimmed);
    else window.localStorage.removeItem(NAME_KEY);
  } catch {
  }
  writeNameCookie(trimmed || null);
  const next = { ...store.getSnapshot(), name: trimmed || null };
  recordMonogram(next);
  store.publish(next);
}
