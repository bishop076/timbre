import { createLocalStore, readItem, useLocalStore, writeItem } from "../local-store.ts";

interface VolumeState {
  volume: number;
  muted: boolean;
}

const VOLUME_KEY = "timbre:volume";
const MUTED_KEY = "timbre:muted";

const DEFAULT: VolumeState = { volume: 100, muted: false };

/**
 * The stored level, or the default — and silence is never the default.
 *
 * `Number(raw ?? NaN)` was the whole of this, and `Number("")` is `0`: an empty string under
 * `timbre:volume` — which is what a half-finished write, a hand edit, or any tool that clears a
 * value rather than removing the key leaves behind — read back as a *valid* level of zero. The
 * app then came up silent with the slider at the bottom and no way to tell that from a broken
 * player, and the next write persisted the zero. `Number(" ")` and `Number("0x40")` are the same
 * trick. A level has to be written out as digits to count as one.
 */
export function parseVolume(raw: string | null): number {
  if (raw === null || !/^\d+(\.\d+)?$/.test(raw.trim())) return DEFAULT.volume;
  const level = Number(raw);
  return level >= 0 && level <= 100 ? level : DEFAULT.volume;
}

const store = createLocalStore<VolumeState>({
  read: () => ({
    volume: parseVolume(readItem(VOLUME_KEY)),
    muted: readItem(MUTED_KEY) === "1",
  }),
  initial: DEFAULT,
  // Both through `writeItem`, so a full or blocked `localStorage` does not throw out of the
  // first call and leave the second key describing a state that no longer exists.
  write: (next) => {
    const level = writeItem(VOLUME_KEY, String(next.volume));
    return writeItem(MUTED_KEY, next.muted ? "1" : "0") && level;
  },
  keys: [VOLUME_KEY, MUTED_KEY],
});

export const getVolumeSnapshot = store.getSnapshot;

export function useVolume(): VolumeState {
  return useLocalStore(store);
}

export function writeVolume(level: number): void {
  const wanted = Number.isFinite(level) ? level : DEFAULT.volume;
  store.save({ volume: Math.round(Math.min(100, Math.max(0, wanted))), muted: false });
}

export function writeMuteToggle(): void {
  const current = getVolumeSnapshot();
  store.save({ ...current, muted: !current.muted });
}
