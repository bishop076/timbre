import { useSyncExternalStore } from "react";

import { formatClock } from "../duration.ts";
import { createNotifier } from "../local-store.ts";
import type { PlayState } from "./player-context";

export const SLEEP_MINUTES = [15, 30, 45, 60] as const;

export type SleepTimer =
  | { kind: "off" }
  | { kind: "timed"; endsAt: number; minutes: number }
  | { kind: "due" }
  | { kind: "track-end" };

const OFF: SleepTimer = { kind: "off" };
const DUE: SleepTimer = { kind: "due" };
const TRACK_END: SleepTimer = { kind: "track-end" };

export function secondsLeft(timer: SleepTimer, now: number): number | null {
  if (timer.kind === "due") return 0;
  if (timer.kind !== "timed") return null;
  return Math.max(0, Math.ceil((timer.endsAt - now) / 1000));
}

export function formatRemaining(seconds: number): string {
  return formatClock(seconds);
}

export function trackSecondsLeft(position: number, duration: number, rate: number): number | null {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const left = Math.max(0, duration - (Number.isFinite(position) ? position : 0));
  return Math.ceil(left / (rate > 0 ? rate : 1));
}

export function whenDue(state: PlayState): "pause" | "wait" | "done" {
  if (state === "playing") return "pause";
  if (state === "loading" || state === "resolving") return "wait";
  return "done";
}

export function describeSleep(timer: SleepTimer, seconds: number | null): string | null {
  if (timer.kind === "off") return null;
  if (timer.kind === "track-end") return "Pausing when this track ends";
  if (timer.kind === "due" || seconds === 0) return "Pausing now";
  return `Pausing in ${formatRemaining(seconds ?? 0)}`;
}

const changes = createNotifier();
const ticks = createNotifier();
let timer: SleepTimer = OFF;
let remaining: number | null = null;
let clock: ReturnType<typeof setInterval> | null = null;

function set(next: SleepTimer): void {
  timer = next;
  const left = secondsLeft(next, Date.now());
  if (left !== remaining) {
    remaining = left;
    ticks.emit();
  }
  changes.emit();
}

function stopClock(): void {
  if (clock !== null) clearInterval(clock);
  clock = null;
}

function tick(): void {
  if (timer.kind !== "timed") {
    stopClock();
    return;
  }
  const left = secondsLeft(timer, Date.now());
  if (left !== remaining) {
    remaining = left;
    ticks.emit();
  }
  if (left === 0) {
    stopClock();
    set(DUE);
  }
}

export function startSleepTimer(minutes: number): void {
  stopClock();
  set({ kind: "timed", endsAt: Date.now() + minutes * 60_000, minutes });
  clock = setInterval(tick, 1000);
}

export function sleepAtTrackEnd(): void {
  stopClock();
  set(TRACK_END);
}

export function cancelSleepTimer(): void {
  stopClock();
  if (timer.kind !== "off") set(OFF);
}

export function takeTrackEndStop(): boolean {
  if (timer.kind !== "track-end") return false;
  set(OFF);
  return true;
}

export function useSleepTimer(): SleepTimer {
  return useSyncExternalStore(changes.subscribe, () => timer, () => OFF);
}

export function useSleepSecondsLeft(): number | null {
  return useSyncExternalStore(ticks.subscribe, () => remaining, () => null);
}
