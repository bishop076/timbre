// Playback speed: the stored preference, and which of the players can honour it.
//
// Only two of them can. The `<audio>` element Timbre owns takes any rate, and YouTube's IFrame
// API takes whichever rates it lists for the video in hand. SoundCloud's, Mixcloud's,
// Spotify's, Apple's and Deezer's widgets expose play, pause, seek and volume and nothing
// else — no rate call exists to make — so for those the control says so rather than
// accepting a choice nothing will act on.

import { useSyncExternalStore } from "react";

import { createLocalStore, createNotifier, useLocalStore } from "../local-store.ts";

/** What the menu offers. Past 2× speech smears and music stops being music; below 0.75×
 * neither is much use, and YouTube's own ladder has nothing between its quarter steps. */
export const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;

export const NORMAL_SPEED = 1;

/** Rates arrive from YouTube as floats; two within this are the same rate. */
const EPSILON = 0.001;

function sameRate(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

/** A stored value, validated: anything that is not one of {@link SPEEDS} reads as normal. */
export function parseSpeed(raw: unknown): number {
  const value = typeof raw === "string" ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isFinite(value)) return NORMAL_SPEED;
  return SPEEDS.find((speed) => sameRate(speed, value)) ?? NORMAL_SPEED;
}

/**
 * The menu's speeds that a player listing `available` will actually play.
 *
 * An empty list means the player has not said yet, and is read as "everything": YouTube only
 * reports its rates once a video has loaded, and greying the whole menu out for the second
 * before it does would be a worse answer than the one it almost always gives.
 */
export function offeredSpeeds(available: readonly number[]): number[] {
  if (available.length === 0) return [...SPEEDS];
  return SPEEDS.filter((speed) => available.some((rate) => sameRate(rate, speed)));
}

/** What to hand the player: the preference when it is offered, normal speed when it is not.
 * Not the nearest offered rate — a reader who picked 1.25× and hears 1.5× has been
 * overruled, while one who hears 1× can see why in the menu. */
export function speedToApply(preferred: number, available: readonly number[]): number {
  return offeredSpeeds(available).some((speed) => sameRate(speed, preferred))
    ? preferred
    : NORMAL_SPEED;
}

/** `1×`, `1.25×`, `0.75×`. */
export function formatSpeed(rate: number): string {
  return `${Number(rate.toFixed(2))}×`;
}

export type SpeedSupport =
  | { supported: true; speeds: number[] }
  | { supported: false; reason: string };

/**
 * Whether the player on screen can change speed, and to what.
 *
 * **Mirrors the player choice in `now-playing.tsx`, in the same order.** That file decides
 * which player mounts from these same fields, and a control that reads them differently
 * would offer speed on a SoundCloud widget or refuse it on the `<audio>` element.
 */
export function speedSupport(playing: {
  activeSource: string | null;
  videoId: string | null;
  streamUrl: string | null;
  mixcloudKey: string | null;
  spotifyTrackId: string | null;
  subscription: "apple" | "deezer" | null;
  /** What YouTube last reported, and for which video. A report for another video is stale. */
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
    // One speed is no choice at all: YouTube answers `[1]` for a video it will not vary.
    if (speeds.length < 2) {
      return { supported: false, reason: "YouTube only plays this video at normal speed." };
    }
    return { supported: true, speeds };
  }

  return { supported: false, reason: "Nothing is playing." };
}

/*
 * **Remembered across reloads, like the volume.** Speed is a way of listening rather than a
 * property of one track — someone working through lectures at 1.25× wants that tomorrow
 * too — and the transport shows the rate whenever it is not 1×, so a remembered speed is
 * never an invisible one. Followed across tabs for the same reason volume is: it is an
 * output preference, not something that steers this tab's queue.
 */
const SPEED_KEY = "timbre:speed";

const speedStore = createLocalStore<number>({
  read: () => {
    try {
      return parseSpeed(window.localStorage.getItem(SPEED_KEY));
    } catch {
      // Private browsing and blocked storage both throw rather than return null.
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

/** The rates YouTube lists for one video. Kept apart from the context: it is the player's to
 * report and the menu's to read, and nothing else in the app cares. */
export interface YouTubeRates {
  videoId: string;
  rates: readonly number[];
}

const rateReports = createNotifier();
let youtubeRates: YouTubeRates | null = null;

export function publishYouTubeRates(videoId: string, rates: readonly number[]): void {
  // Reported on every PLAYING, so most reports repeat the last; an unchanged one is not news.
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
