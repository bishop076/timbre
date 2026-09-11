import { createLocalStore, readItem, useLocalStore } from "../local-store.ts";

interface VolumeState {
  volume: number;
  muted: boolean;
}

const VOLUME_KEY = "timbre:volume";
const MUTED_KEY = "timbre:muted";

const DEFAULT: VolumeState = { volume: 100, muted: false };

const store = createLocalStore<VolumeState>({
  read: () => {
    const stored = Number(readItem(VOLUME_KEY) ?? Number.NaN);
    return {
      volume: Number.isFinite(stored) && stored >= 0 && stored <= 100 ? stored : DEFAULT.volume,
      muted: readItem(MUTED_KEY) === "1",
    };
  },
  initial: DEFAULT,
  write: (next) => {
    window.localStorage.setItem(VOLUME_KEY, String(next.volume));
    window.localStorage.setItem(MUTED_KEY, next.muted ? "1" : "0");
  },
  keys: [VOLUME_KEY, MUTED_KEY],
});

export const getVolumeSnapshot = store.getSnapshot;

export function useVolume(): VolumeState {
  return useLocalStore(store);
}

export function writeVolume(level: number): void {
  store.save({ volume: Math.round(Math.min(100, Math.max(0, level))), muted: false });
}

export function writeMuteToggle(): void {
  const current = getVolumeSnapshot();
  store.save({ ...current, muted: !current.muted });
}
