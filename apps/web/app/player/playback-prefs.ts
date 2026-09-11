"use client";

import { createJsonStore, useLocalStore } from "../local-store.ts";

interface PlaybackPrefs {
  continueWithRadio: boolean;
  lyricsByDefault: boolean;
}

const store = createJsonStore<PlaybackPrefs>(
  "timbre:playback-prefs",
  { continueWithRadio: true, lyricsByDefault: false },
  (stored) => {
    const value = stored as Partial<PlaybackPrefs>;
    return {
      continueWithRadio: value.continueWithRadio !== false,
      lyricsByDefault: value.lyricsByDefault === true,
    };
  },
);

export function usePlaybackPrefs(): PlaybackPrefs {
  return useLocalStore(store);
}

export const getPlaybackPrefs = store.getSnapshot;

export function setPlaybackPref<K extends keyof PlaybackPrefs>(key: K, value: PlaybackPrefs[K]): void {
  store.save({ ...store.getSnapshot(), [key]: value });
}
