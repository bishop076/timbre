// The sleep timer: pause after a while, or when the playing track ends.
//
// **Held in memory, deliberately.** A timer that survived a reload would have to decide what
// a stale deadline means on a page that is no longer playing anything, and the honest answer
// — nothing — is what forgetting it gives for free. Closing or reloading the tab ends it, and
// the menu says so.
//
// The clock lives here rather than in a component so the countdown and the deadline cannot
// disagree: one interval both redraws the remaining time and notices it has run out. It
// only ever marks the timer *due*; pausing is `use-sleep-timer.ts`'s, which can see the
// player's state and wait out a track that is still loading.

import { useSyncExternalStore } from "react";

import { formatClock } from "../duration.ts";
import { createNotifier } from "../local-store.ts";
import type { PlayState } from "./player-context";

export const SLEEP_MINUTES = [15, 30, 45, 60] as const;

export type SleepTimer =
  | { kind: "off" }
  /** Counting down to `endsAt`, a wall-clock time in ms. */
  | { kind: "timed"; endsAt: number; minutes: number }
  /** Time is up, but nothing has been paused yet — see {@link whenDue}. */
  | { kind: "due" }
  /** Stop when the playing track ends instead of starting the next. */
  | { kind: "track-end" };

const OFF: SleepTimer = { kind: "off" };
const DUE: SleepTimer = { kind: "due" };
const TRACK_END: SleepTimer = { kind: "track-end" };

/**
 * Whole seconds left on a countdown, or `null` when nothing is counting.
 *
 * Rounded up, so a fifteen-minute timer first reads 15:00 rather than 14:59, and its last
 * second reads 0:01 rather than a 0:00 that has not paused anything yet.
 */
export function secondsLeft(timer: SleepTimer, now: number): number | null {
  if (timer.kind === "due") return 0;
  if (timer.kind !== "timed") return null;
  return Math.max(0, Math.ceil((timer.endsAt - now) / 1000));
}

/** `14:32`, and `60:00` rather than `1:00:00` — no option is longer than an hour, and a
 * countdown that drops a field after its first second shifts the row it sits in. */
export function formatRemaining(seconds: number): string {
  return formatClock(seconds);
}

/**
 * How long the playing track has left in wall-clock seconds, or `null` without a length.
 * Divided by the rate that is actually playing, so at 1.5× a three-minute remainder reads
 * two — which is when the pause will come.
 */
export function trackSecondsLeft(position: number, duration: number, rate: number): number | null {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const left = Math.max(0, duration - (Number.isFinite(position) ? position : 0));
  return Math.ceil(left / (rate > 0 ? rate : 1));
}

/**
 * What a due timer should do given the player's state.
 *
 * `pause` only when something is audibly playing — the toggle is a toggle, and pressing it on
 * a paused player would *start* the music the reader asked to stop. `wait` across a load: a
 * timer that runs out between two tracks would otherwise find nothing playing, give up, and
 * let the next track play all night. Anything else is already quiet, so the timer is done.
 */
export function whenDue(state: PlayState): "pause" | "wait" | "done" {
  if (state === "playing") return "pause";
  if (state === "loading" || state === "resolving") return "wait";
  return "done";
}

/** The status line, for the menu and the trigger's label. */
export function describeSleep(timer: SleepTimer, seconds: number | null): string | null {
  if (timer.kind === "off") return null;
  if (timer.kind === "track-end") return "Pausing when this track ends";
  if (timer.kind === "due" || seconds === 0) return "Pausing now";
  return `Pausing in ${formatRemaining(seconds ?? 0)}`;
}

/*
 * The store. Two notifiers, because they change at different rates: the timer's kind a few
 * times a session, and the countdown once a second. The shell's driver subscribes only to
 * the first, so the whole app does not re-render on every tick.
 */
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

/**
 * Once a second, from the deadline rather than by counting: a tab in the background has its
 * timers slowed, and a laptop that sleeps stops them outright, so a counter would drift
 * where a deadline cannot. The pause can come late by as much as the browser delays one
 * tick — about a second while the tab is audible — but never early.
 */
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

/**
 * Whether the track that just ended should be the last, spending the request if so. Called
 * from `handleEnded`, which every player reports an ending through — the one place that sees
 * a track finish before the queue moves on.
 */
export function takeTrackEndStop(): boolean {
  if (timer.kind !== "track-end") return false;
  set(OFF);
  return true;
}

export function useSleepTimer(): SleepTimer {
  return useSyncExternalStore(changes.subscribe, () => timer, () => OFF);
}

/** Whole seconds left on a countdown, redrawn once a second. Only what shows it should subscribe. */
export function useSleepSecondsLeft(): number | null {
  return useSyncExternalStore(ticks.subscribe, () => remaining, () => null);
}
