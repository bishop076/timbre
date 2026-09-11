"use client";

import { createLocalStore, useLocalStore } from "../local-store.ts";

export interface PlaybackPrefs {
  continueWithRadio: boolean;
  lyricsByDefault: boolean;
}

const KEY = "timbre:playback-prefs";

const DEFAULTS: PlaybackPrefs = { continueWithRadio: true, lyricsByDefault: false };

function read(): PlaybackPrefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULTS;

    const value = parsed as Partial<PlaybackPrefs>;
    return {
      continueWithRadio: value.continueWithRadio !== false,
      lyricsByDefault: value.lyricsByDefault === true,
    };
  } catch {
    return DEFAULTS;
  }
}

const store = createLocalStore<PlaybackPrefs>({
  read,
  initial: DEFAULTS,
  write: (next) => window.localStorage.setItem(KEY, JSON.stringify(next)),
  keys: [KEY],
});

export function usePlaybackPrefs(): PlaybackPrefs {
  return useLocalStore(store);
}

export function getPlaybackPrefs(): PlaybackPrefs {
  return store.getSnapshot();
}

export function setPlaybackPref<K extends keyof PlaybackPrefs>(key: K, value: PlaybackPrefs[K]): void {
  store.save({ ...store.getSnapshot(), [key]: value });
}
