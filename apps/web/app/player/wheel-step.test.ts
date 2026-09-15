import assert from "node:assert/strict";
import { test } from "node:test";

import { pixelDelta, wheelSteps, WHEEL_THRESHOLD } from "./wheel-step.ts";

function spend(deltas: number[]) {
  let carried = 0;
  let spent = 0;
  for (const delta of deltas) {
    const { steps, rest } = wheelSteps(carried + delta);
    spent += steps;
    carried = rest;
  }
  return { spent, carried };
}

test("pixel deltas pass through, and line and page deltas are converted", () => {
  assert.equal(pixelDelta(100, 0), 100);
  assert.equal(pixelDelta(-42, 0), -42);
  assert.ok(pixelDelta(3, 1) > pixelDelta(3, 0));
  assert.ok(pixelDelta(1, 2) > pixelDelta(1, 1));
});

test("a scroll shorter than one step moves nothing but is remembered", () => {
  assert.deepEqual(wheelSteps(10), { steps: 0, rest: 10 });
});

test("small deltas accumulate into a step", () => {
  assert.equal(spend(Array(10).fill(8)).spent, 1, "80px of scrolling should move the volume");
});

test("one mouse notch is worth a couple of steps", () => {
  assert.equal(wheelSteps(pixelDelta(100, 0)).steps, 2);
});

test("the two directions are symmetric, and a partial step never rounds away from zero", () => {
  assert.deepEqual(wheelSteps(-WHEEL_THRESHOLD * 2), { steps: -2, rest: 0 });
  assert.deepEqual(wheelSteps(WHEEL_THRESHOLD * 2), { steps: 2, rest: 0 });
  assert.deepEqual(wheelSteps(-WHEEL_THRESHOLD / 2), { steps: 0, rest: -WHEEL_THRESHOLD / 2 });
  assert.deepEqual(wheelSteps(WHEEL_THRESHOLD / 2), { steps: 0, rest: WHEEL_THRESHOLD / 2 });
});

test("nudging back and forth returns to where it started", () => {
  assert.deepEqual(spend([30, -30, 30, -30, 20, -20]), { spent: 0, carried: 0 });
});

test("no single event is worth more than a notch, however it reports its distance", () => {
  // `deltaMode` 2 is a whole page. Measured on the real control, one of those events took the
  // volume from 100% to 55% — where the same flick of a pixel-reporting mouse moves it 10%.
  const notch = pixelDelta(100, 0);
  for (const [deltaY, deltaMode] of [[1, 2], [40, 1], [4000, 0]] as const) {
    assert.equal(
      wheelSteps(pixelDelta(deltaY, deltaMode)).steps,
      wheelSteps(notch).steps,
      `deltaY ${deltaY} in mode ${deltaMode} should be worth one notch at most`,
    );
  }
  assert.equal(pixelDelta(-1, 2), -notch, "and the same going the other way");
});

test("the surplus of an oversized event is dropped, not owed to the next one", () => {
  assert.equal(spend([pixelDelta(1, 2), pixelDelta(1, 2)]).spent, 4, "two pages, two notches");
});

test("a delta that is not a measurement leaves the volume where it is", () => {
  // And, more to the point, does not poison the carried remainder for the rest of the session.
  for (const delta of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(pixelDelta(delta, 0), 0, String(delta));
  }
  assert.deepEqual(spend([pixelDelta(Number.NaN, 0), 60]), { spent: 1, carried: 10 });
});
