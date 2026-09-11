import { useSyncExternalStore } from "react";

import { createLocalStore, createNotifier, useLocalStore } from "../local-store.ts";

export const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;

export const NORMAL_SPEED = 1;

const EPSILON = 0.001;

function sameRate(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
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

export type SpeedSupport =
  | { supported: true; speeds: number[] }
  | { supported: false; reason: string };

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

  if (playing.videoId) {
    const reported =
      playing.youtubeRates?.videoId === playing.videoId ? playing.youtubeRates.rates : [];
    const speeds = offeredSpeeds(reported);
    if (speeds.length < 2) {
      return { supported: false, reason: "YouTube only plays this video at normal speed." };
    }
    return { supported: true, speeds };
  }

  return { supported: false, reason: "Nothing is playing." };
}

const SPEED_KEY = "timbre:speed";

const speedStore = createLocalStore<number>({
  read: () => {
    try {
      return parseSpeed(window.localStorage.getItem(SPEED_KEY));
    } catch {
      return NORMAL_SPEED;
    }
  },
  initial: NORMAL_SPEED,
  write: (rate) => window.localStorage.setItem(SPEED_KEY, String(rate)),
  keys: [SPEED_KEY],
});

export function useSpeed(): number {
  return useLocalStore(speedStore);
}

export function getSpeed(): number {
  return speedStore.getSnapshot();
}

export function writeSpeed(rate: number): void {
  speedStore.save(parseSpeed(rate));
}

export interface YouTubeRates {
  videoId: string;
  rates: readonly number[];
}

const rateReports = createNotifier();
let youtubeRates: YouTubeRates | null = null;

export function publishYouTubeRates(videoId: string, rates: readonly number[]): void {
  if (
    youtubeRates?.videoId === videoId &&
    youtubeRates.rates.length === rates.length &&
    youtubeRates.rates.every((rate, at) => sameRate(rate, rates[at]!))
  ) {
    return;
  }
  youtubeRates = { videoId, rates: [...rates] };
  rateReports.emit();
}

export function useYouTubeRates(): YouTubeRates | null {
  return useSyncExternalStore(
    rateReports.subscribe,
    () => youtubeRates,
    () => null,
  );
}
