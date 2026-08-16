// Output level, stored outside React so it survives a reload without a cascading render
// after mount. 0–100, because that is what both the YouTube IFrame API and the SoundCloud
// widget take — converting per call site invites a scale bug.

import { createLocalStore } from "../local-store.ts";

export interface VolumeState {
  volume: number;
  muted: boolean;
}

const VOLUME_KEY = "timbre:volume";
const MUTED_KEY = "timbre:muted";

/** Referentially stable, and what hydration renders against. */
const DEFAULT: VolumeState = { volume: 100, muted: false };

function read(): VolumeState {
  try {
    // `Number(null)` is 0 and 0 is a valid volume, so a missing key read that way
    // silently mutes every first-time visitor. Rule out null before parsing.
    const raw = window.localStorage.getItem(VOLUME_KEY);
    const stored = raw === null ? Number.NaN : Number(raw);
    return {
      volume: Number.isFinite(stored) && stored >= 0 && stored <= 100 ? stored : DEFAULT.volume,
      muted: window.localStorage.getItem(MUTED_KEY) === "1",
    };
  } catch {
    // Private browsing and blocked storage both throw rather than return null.
    return DEFAULT;
  }
}

// Two keys, so both are followed across tabs: another tab moved the volume, match it rather
// than fighting over it.
const store = createLocalStore<VolumeState>({
  read,
  initial: DEFAULT,
  write: (next) => {
    window.localStorage.setItem(VOLUME_KEY, String(next.volume));
    window.localStorage.setItem(MUTED_KEY, next.muted ? "1" : "0");
  },
  keys: [VOLUME_KEY, MUTED_KEY],
});

export const subscribeVolume = store.subscribe;

/** Lazy so the module stays importable on the server; the same object thereafter, as
 * `getSnapshot` requires. */
export const getVolumeSnapshot = store.getSnapshot;

export const getVolumeServerSnapshot = store.getServerSnapshot;

/** Sets the level. Unmutes, because that is what moving a slider means. */
export function writeVolume(level: number): void {
  store.save({ volume: Math.round(Math.min(100, Math.max(0, level))), muted: false });
}

export function writeMuteToggle(): void {
  const current = getVolumeSnapshot();
  store.save({ ...current, muted: !current.muted });
}
