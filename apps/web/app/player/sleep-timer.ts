import { formatClock } from "../duration.ts";
import { createLocalStore, useLocalStore } from "../local-store.ts";
import type { PlayState } from "./player-context";

export const SLEEP_MINUTES = [15, 30, 45, 60] as const;

export type SleepTimer =
  | { kind: "off" }
  | { kind: "timed"; endsAt: number; minutes: number }
  | { kind: "due" }
  | { kind: "track-end" };

const OFF: SleepTimer = { kind: "off" };

export function secondsLeft(timer: SleepTimer, now: number): number | null {
  if (timer.kind === "due") return 0;
  if (timer.kind !== "timed") return null;
  return Math.max(0, Math.ceil((timer.endsAt - now) / 1000));
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
  return `Pausing in ${formatClock(seconds ?? 0)}`;
}

const timerStore = createLocalStore<SleepTimer>({ initial: OFF });
const remainingStore = createLocalStore<number | null>({ initial: null });
let clock: ReturnType<typeof setInterval> | undefined;

function countDown(timer: SleepTimer): number | null {
  const left = secondsLeft(timer, Date.now());
  if (left !== remainingStore.getSnapshot()) remainingStore.publish(left);
  return left;
}

function set(next: SleepTimer): void {
  clearInterval(clock);
  countDown(next);
  timerStore.publish(next);
}

export function startSleepTimer(minutes: number): void {
  set({ kind: "timed", endsAt: Date.now() + minutes * 60_000, minutes });
  clock = setInterval(() => {
    if (countDown(timerStore.getSnapshot()) === 0) set({ kind: "due" });
  }, 1000);
}

export function sleepAtTrackEnd(): void {
  set({ kind: "track-end" });
}

export function cancelSleepTimer(): void {
  if (timerStore.getSnapshot().kind !== "off") set(OFF);
}

export function takeTrackEndStop(): boolean {
  if (timerStore.getSnapshot().kind !== "track-end") return false;
  set(OFF);
  return true;
}

export function useSleepTimer(): SleepTimer {
  return useLocalStore(timerStore);
}

export function useSleepSecondsLeft(): number | null {
  return useLocalStore(remainingStore);
}
