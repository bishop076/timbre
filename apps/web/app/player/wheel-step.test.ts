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
