import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import {
  cancelSleepTimer,
  describeSleep,
  getSleepSecondsLeft,
  getSleepTimer,
  secondsLeft,
  sleepAtTrackEnd,
  startSleepTimer,
  takeTrackEndStop,
  trackSecondsLeft,
  whenDue,
  type SleepTimer,
} from "./sleep-timer.ts";

const timed = (endsAt: number): SleepTimer => ({ kind: "timed", endsAt, minutes: 15 });

test("a countdown rounds up, never reads 0:00 before it is due, and never goes negative", () => {
  assert.equal(secondsLeft(timed(15 * 60_000), 0), 900);
  assert.equal(secondsLeft(timed(1000), 1), 1);
  assert.equal(secondsLeft(timed(1000), 999), 1);
  assert.equal(secondsLeft(timed(1000), 1000), 0);
  assert.equal(secondsLeft(timed(1000), 90_000), 0);
});

test("only a countdown has seconds left", () => {
  assert.equal(secondsLeft({ kind: "off" }, 0), null);
  assert.equal(secondsLeft({ kind: "track-end" }, 0), null);
  assert.equal(secondsLeft({ kind: "due" }, 0), 0);
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
  assert.equal(whenDue("paused"), "done");
  assert.equal(whenDue("idle"), "done");
  assert.equal(whenDue("unplayable"), "done");
});

test("the status line says what will happen, in minutes and seconds up to an hour", () => {
  assert.equal(describeSleep({ kind: "off" }, null), null);
  assert.equal(describeSleep(timed(0), 872), "Pausing in 14:32");
  assert.equal(describeSleep(timed(0), 59), "Pausing in 0:59");
  assert.equal(describeSleep(timed(0), 3600), "Pausing in 60:00");
  assert.equal(describeSleep({ kind: "track-end" }, null), "Pausing when this track ends");
  assert.equal(describeSleep({ kind: "due" }, 0), "Pausing now");
});

test("the end-of-track stop is spent by the first ending, and withdrawn by cancelling", () => {
  cancelSleepTimer();
  assert.equal(takeTrackEndStop(), false);

  sleepAtTrackEnd();
  assert.equal(takeTrackEndStop(), true);
  assert.equal(takeTrackEndStop(), false);

  sleepAtTrackEnd();
  cancelSleepTimer();
  assert.equal(takeTrackEndStop(), false);
});

// The clock is mocked, never waited on: the countdown ticks once a second and its end is
// fifteen minutes out, so a test that sat through either would be a test nobody runs.
function onAMockedClock(t: TestContext) {
  // Put the running clock away under the timer implementation that made it: the mock is torn
  // down between tests, and a handle from a previous one is not one this test's mock can clear.
  cancelSleepTimer();
  t.mock.timers.enable({ apis: ["setInterval", "Date"] });
}

test("the countdown falls due at its end and not a tick before", (t) => {
  onAMockedClock(t);
  startSleepTimer(15);

  t.mock.timers.tick(14 * 60_000);
  assert.equal(getSleepTimer().kind, "timed");
  assert.equal(getSleepSecondsLeft(), 60);

  t.mock.timers.tick(59_000);
  assert.equal(getSleepTimer().kind, "timed", "0:01 left is still a countdown");

  t.mock.timers.tick(1000);
  assert.equal(getSleepTimer().kind, "due");
});

test("a cancelled countdown never comes due, however long the tab is left open", (t) => {
  onAMockedClock(t);
  startSleepTimer(15);
  t.mock.timers.tick(60_000);
  cancelSleepTimer();

  t.mock.timers.tick(60 * 60_000);
  assert.equal(getSleepTimer().kind, "off", "a cancelled timer must not pause the music later");
  assert.equal(getSleepSecondsLeft(), null, "and must not leave a countdown on the menu");
});

test("choosing a new length replaces the running countdown rather than racing it", (t) => {
  onAMockedClock(t);
  startSleepTimer(15);
  t.mock.timers.tick(60_000);
  startSleepTimer(45);

  t.mock.timers.tick(20 * 60_000);
  const timer = getSleepTimer();
  assert.equal(timer.kind, "timed", "the first countdown's clock must not still be running");
  assert.equal(timer.kind === "timed" && timer.minutes, 45);
  assert.equal(getSleepSecondsLeft(), 25 * 60);
});

test("a track ending underneath a countdown does not spend it", (t) => {
  onAMockedClock(t);
  startSleepTimer(15);
  t.mock.timers.tick(60_000);

  assert.equal(takeTrackEndStop(), false, "this stop was not armed at the end of a track");
  t.mock.timers.tick(60_000);
  assert.equal(getSleepTimer().kind, "timed", "and the countdown carries across the track change");
  assert.equal(getSleepSecondsLeft(), 13 * 60);
});

test("switching to the end of the track puts the countdown's clock away", (t) => {
  onAMockedClock(t);
  startSleepTimer(15);
  t.mock.timers.tick(60_000);
  sleepAtTrackEnd();

  t.mock.timers.tick(60 * 60_000);
  assert.equal(getSleepTimer().kind, "track-end", "the old countdown must not overwrite this");
  assert.equal(getSleepSecondsLeft(), null);
  assert.equal(takeTrackEndStop(), true);
});
