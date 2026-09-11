import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cancelSleepTimer,
  describeSleep,
  formatRemaining,
  secondsLeft,
  sleepAtTrackEnd,
  takeTrackEndStop,
  trackSecondsLeft,
  whenDue,
  type SleepTimer,
} from "./sleep-timer.ts";

const timed = (endsAt: number): SleepTimer => ({ kind: "timed", endsAt, minutes: 15 });

test("a countdown rounds up, so it never reads 0:00 before it is due", () => {
  assert.equal(secondsLeft(timed(15 * 60_000), 0), 900);
  assert.equal(secondsLeft(timed(1000), 1), 1);
  assert.equal(secondsLeft(timed(1000), 999), 1);
  assert.equal(secondsLeft(timed(1000), 1000), 0);
});

test("a deadline already passed reads zero, not a negative", () => {
  assert.equal(secondsLeft(timed(1000), 90_000), 0);
});

test("only a countdown has seconds left", () => {
  assert.equal(secondsLeft({ kind: "off" }, 0), null);
  assert.equal(secondsLeft({ kind: "track-end" }, 0), null);
  assert.equal(secondsLeft({ kind: "due" }, 0), 0);
});

test("the remaining time is minutes and seconds, an hour included", () => {
  assert.equal(formatRemaining(900), "15:00");
  assert.equal(formatRemaining(872), "14:32");
  assert.equal(formatRemaining(59), "0:59");
  // Not 1:00:00 — the field would vanish a second later and shift the row.
  assert.equal(formatRemaining(3600), "60:00");
});

test("a track's remainder is measured at the speed it plays", () => {
  assert.equal(trackSecondsLeft(0, 180, 1), 180);
  assert.equal(trackSecondsLeft(60, 180, 1.5), 80);
  assert.equal(trackSecondsLeft(179.2, 180, 1), 1);
  assert.equal(trackSecondsLeft(0, 0, 1), null);
  assert.equal(trackSecondsLeft(Number.NaN, 180, 1), 180);
  assert.equal(trackSecondsLeft(0, 180, 0), 180);
});

test("a due timer pauses only what is playing, and waits out a load", () => {
  assert.equal(whenDue("playing"), "pause");
  assert.equal(whenDue("loading"), "wait");
  assert.equal(whenDue("resolving"), "wait");
  // Toggling any of these would start the music the reader asked to stop.
  assert.equal(whenDue("paused"), "done");
  assert.equal(whenDue("idle"), "done");
  assert.equal(whenDue("unplayable"), "done");
});

test("the status line says what will happen", () => {
  assert.equal(describeSleep({ kind: "off" }, null), null);
  assert.equal(describeSleep(timed(0), 872), "Pausing in 14:32");
  assert.equal(describeSleep({ kind: "track-end" }, null), "Pausing when this track ends");
  assert.equal(describeSleep({ kind: "due" }, 0), "Pausing now");
});

test("the end-of-track stop is spent by the first ending", () => {
  cancelSleepTimer();
  assert.equal(takeTrackEndStop(), false);

  sleepAtTrackEnd();
  assert.equal(takeTrackEndStop(), true);
  // The next track plays on: one stop was asked for.
  assert.equal(takeTrackEndStop(), false);
});

test("cancelling withdraws the end-of-track stop", () => {
  sleepAtTrackEnd();
  cancelSleepTimer();
  assert.equal(takeTrackEndStop(), false);
});
