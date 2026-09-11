import { createLocalStore } from "../local-store.ts";

export interface VolumeState {
  volume: number;
  muted: boolean;
}

const VOLUME_KEY = "timbre:volume";
const MUTED_KEY = "timbre:muted";

const DEFAULT: VolumeState = { volume: 100, muted: false };

function read(): VolumeState {
  try {
    const raw = window.localStorage.getItem(VOLUME_KEY);
    const stored = raw === null ? Number.NaN : Number(raw);
    return {
      volume: Number.isFinite(stored) && stored >= 0 && stored <= 100 ? stored : DEFAULT.volume,
      muted: window.localStorage.getItem(MUTED_KEY) === "1",
    };
  } catch {
    return DEFAULT;
  }
}

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

export const getVolumeSnapshot = store.getSnapshot;

export const getVolumeServerSnapshot = store.getServerSnapshot;

export function writeVolume(level: number): void {
  store.save({ volume: Math.round(Math.min(100, Math.max(0, level))), muted: false });
}

export function writeMuteToggle(): void {
  const current = getVolumeSnapshot();
  store.save({ ...current, muted: !current.muted });
}
