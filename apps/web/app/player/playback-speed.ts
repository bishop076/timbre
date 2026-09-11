import { createLocalStore, readItem, useLocalStore, writeItem } from "../local-store.ts";

export const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;
export const NORMAL_SPEED = 1;

function sameRate(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.001;
}

export function parseSpeed(raw: unknown): number {
  const value = typeof raw === "string" ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isFinite(value)) return NORMAL_SPEED;
  return SPEEDS.find((speed) => sameRate(speed, value)) ?? NORMAL_SPEED;
}

export function offeredSpeeds(available: readonly number[]): number[] {
  if (available.length === 0) return [...SPEEDS];
  return SPEEDS.filter((speed) => available.some((rate) => sameRate(rate, speed)));
}

export function speedToApply(preferred: number, available: readonly number[]): number {
  return offeredSpeeds(available).some((speed) => sameRate(speed, preferred))
    ? preferred
    : NORMAL_SPEED;
}

export function formatSpeed(rate: number): string {
  return `${Number(rate.toFixed(2))}×`;
}

type SpeedSupport = { supported: true; speeds: number[] } | { supported: false; reason: string };

interface YouTubeRates {
  videoId: string;
  rates: readonly number[];
}

export function speedSupport(playing: {
  activeSource: string | null;
  videoId: string | null;
  streamUrl: string | null;
  mixcloudKey: string | null;
  spotifyTrackId: string | null;
  subscription: "apple" | "deezer" | null;
  youtubeRates: YouTubeRates | null;
}): SpeedSupport {
  const widget = (name: string): SpeedSupport => ({
    supported: false,
    reason: `${name}'s player has no speed control, so this plays at 1×.`,
  });

  if (playing.activeSource === "soundcloud") return widget("SoundCloud");
  if (playing.mixcloudKey) return widget("Mixcloud");
  if (playing.spotifyTrackId) return widget("Spotify");
  if (playing.subscription) return widget(playing.subscription === "apple" ? "Apple Music" : "Deezer");
  if (playing.streamUrl) return { supported: true, speeds: [...SPEEDS] };
  if (!playing.videoId) return { supported: false, reason: "Nothing is playing." };

  const { youtubeRates } = playing;
  const speeds = offeredSpeeds(youtubeRates?.videoId === playing.videoId ? youtubeRates.rates : []);
  return speeds.length < 2
    ? { supported: false, reason: "YouTube only plays this video at normal speed." }
    : { supported: true, speeds };
}

const SPEED_KEY = "timbre:speed";

const speedStore = createLocalStore<number>({
  read: () => parseSpeed(readItem(SPEED_KEY)),
  initial: NORMAL_SPEED,
  write: (rate) => writeItem(SPEED_KEY, String(rate)),
  keys: [SPEED_KEY],
});

export function useSpeed(): number {
  return useLocalStore(speedStore);
}

export function writeSpeed(rate: number): void {
  speedStore.save(parseSpeed(rate));
}

const rateStore = createLocalStore<YouTubeRates | null>({ initial: null });

export function publishYouTubeRates(videoId: string, rates: readonly number[]): void {
  const known = rateStore.getSnapshot();
  if (
    known?.videoId === videoId &&
    known.rates.length === rates.length &&
    known.rates.every((rate, at) => sameRate(rate, rates[at]!))
  ) {
    return;
  }
  rateStore.publish({ videoId, rates: [...rates] });
}

export function useYouTubeRates(): YouTubeRates | null {
  return useLocalStore(rateStore);
}
