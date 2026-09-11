"use client";

// How playback behaves, chosen in Settings → General and kept in this browser. Two answers,
// both defaulting to what Timbre did before there was a choice: the queue runs on into the
// radio, and the expanded player opens on "Up next".

import { createLocalStore, useLocalStore } from "../local-store.ts";

export interface PlaybackPrefs {
  /** At the end of the queue, keep going with songs like the last one. Off stops there. */
  continueWithRadio: boolean;
  /** Open the player on its lyrics rather than on what plays next. */
  lyricsByDefault: boolean;
}

const KEY = "timbre:playback-prefs";

/** Referentially stable, and what the server renders against. */
const DEFAULTS: PlaybackPrefs = { continueWithRadio: true, lyricsByDefault: false };

function read(): PlaybackPrefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULTS;

    const value = parsed as Partial<PlaybackPrefs>;
    // Each field on its own, so a file missing one keeps the default rather than `undefined`.
    return {
      continueWithRadio: value.continueWithRadio !== false,
      lyricsByDefault: value.lyricsByDefault === true,
    };
  } catch {
    // Private browsing throws rather than returning null; so does malformed JSON.
    return DEFAULTS;
  }
}

// Followed across tabs, unlike shuffle and repeat: those steer one tab's queue, while these
// are standing preferences, and a setting changed in one tab should hold in the other.
const store = createLocalStore<PlaybackPrefs>({
  read,
  initial: DEFAULTS,
  write: (next) => window.localStorage.setItem(KEY, JSON.stringify(next)),
  keys: [KEY],
});

export function usePlaybackPrefs(): PlaybackPrefs {
  return useLocalStore(store);
}

/** The current answer, for code that runs outside a render — an event handler or a fetch
 * callback, which would otherwise read whatever it closed over. */
export function getPlaybackPrefs(): PlaybackPrefs {
  return store.getSnapshot();
}

export function setPlaybackPref<K extends keyof PlaybackPrefs>(key: K, value: PlaybackPrefs[K]): void {
  store.save({ ...store.getSnapshot(), [key]: value });
}
