/**
 * Output level, stored outside React.
 *
 * Volume has to survive a reload — an app that comes back at full blast every
 * time is a bad neighbour — which means localStorage, and localStorage is not
 * something React can render on the server. Reading it into state after mount
 * would work but is a cascading render by another name; this is what
 * `useSyncExternalStore` exists for. Hydration uses the server snapshot, then
 * React re-reads the real one, so the two never disagree.
 *
 * The level is 0–100 because that is what both the YouTube IFrame API and the
 * SoundCloud widget take. Converting at every call site would only create
 * places to get the scale wrong.
 */

export interface VolumeState {
  volume: number;
  muted: boolean;
}

const VOLUME_KEY = "timbre:volume";
const MUTED_KEY = "timbre:muted";

/** Referentially stable, and what hydration renders against. */
const DEFAULT: VolumeState = { volume: 100, muted: false };

let snapshot: VolumeState = DEFAULT;
let loaded = false;

const listeners = new Set<() => void>();

function read(): VolumeState {
  try {
    // `Number(null)` is 0, and 0 is a perfectly valid volume — so a missing key
    // read this way silently mutes every first-time visitor. The null has to be
    // ruled out before the number is parsed, not after.
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

function write(next: VolumeState): void {
  snapshot = next;
  try {
    window.localStorage.setItem(VOLUME_KEY, String(next.volume));
    window.localStorage.setItem(MUTED_KEY, next.muted ? "1" : "0");
  } catch {
    // Not being able to remember it is no reason to refuse to change it.
  }
  for (const listener of listeners) listener();
}

/** Another tab moved the volume; match it rather than fighting over it. */
function onStorage(event: StorageEvent): void {
  if (event.key !== VOLUME_KEY && event.key !== MUTED_KEY) return;
  snapshot = read();
  for (const listener of listeners) listener();
}

export function subscribeVolume(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function getVolumeSnapshot(): VolumeState {
  // First read is lazy so the module stays importable on the server; every
  // read after it is a cached object, as getSnapshot requires.
  if (!loaded) {
    loaded = true;
    snapshot = read();
  }
  return snapshot;
}

export function getVolumeServerSnapshot(): VolumeState {
  return DEFAULT;
}

/** Sets the level. Unmutes, because that is what moving a slider means. */
export function writeVolume(level: number): void {
  write({ volume: Math.round(Math.min(100, Math.max(0, level))), muted: false });
}

export function writeMuteToggle(): void {
  write({ ...getVolumeSnapshot(), muted: !getVolumeSnapshot().muted });
}
