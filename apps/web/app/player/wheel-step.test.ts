import assert from "node:assert/strict";
import { test } from "node:test";

import { pixelDelta, wheelSteps, WHEEL_THRESHOLD } from "./wheel-step.ts";

test("pixel deltas pass through unchanged", () => {
  assert.equal(pixelDelta(100, 0), 100);
  assert.equal(pixelDelta(-42, 0), -42);
});

test("line and page deltas are converted, not taken literally", () => {
  // Firefox commonly reports lines. Treating 3 lines as 3 pixels leaves the
  // control almost inert there.
  assert.ok(pixelDelta(3, 1) > pixelDelta(3, 0));
  assert.ok(pixelDelta(1, 2) > pixelDelta(1, 1));
});

test("a scroll shorter than one step moves nothing but is remembered", () => {
  const { steps, rest } = wheelSteps(10);
  assert.equal(steps, 0);
  assert.equal(rest, 10, "the distance has to carry, or a trackpad never moves the volume");
});

test("small deltas accumulate into a step", () => {
  // A trackpad flick, sixty small events rather than one large one.
  let carried = 0;
  let spent = 0;
  for (let i = 0; i < 10; i += 1) {
    const { steps, rest } = wheelSteps(carried + 8);
    spent += steps;
    carried = rest;
  }
  assert.ok(spent > 0, "80px of scrolling should have moved the volume");
  assert.equal(spent, 1);
});

test("one mouse notch is worth a couple of steps", () => {
  const { steps } = wheelSteps(pixelDelta(100, 0));
  assert.equal(steps, 2);
});

test("the two directions are symmetric", () => {
  const up = wheelSteps(-WHEEL_THRESHOLD * 2);
  const down = wheelSteps(WHEEL_THRESHOLD * 2);

  assert.equal(up.steps, -2);
  assert.equal(down.steps, 2);
  assert.equal(up.rest, 0);
  assert.equal(down.rest, 0);
});

test("a partial step never rounds away from zero", () => {
  /*
   * `Math.floor` would make these asymmetric: floor(-0.5) is -1, so scrolling
   * up would spend a step it had not earned while scrolling down waited. The
   * control would drift quieter over a series of small nudges back and forth.
   */
  const up = wheelSteps(-WHEEL_THRESHOLD / 2);
  const down = wheelSteps(WHEEL_THRESHOLD / 2);

  assert.equal(up.steps, 0);
  assert.equal(down.steps, 0);
  assert.equal(up.rest, -WHEEL_THRESHOLD / 2);
  assert.equal(down.rest, WHEEL_THRESHOLD / 2);
});

test("nudging back and forth returns to where it started", () => {
  let carried = 0;
  let spent = 0;
  for (const delta of [30, -30, 30, -30, 20, -20]) {
    const { steps, rest } = wheelSteps(carried + delta);
    spent += steps;
    carried = rest;
  }
  assert.equal(spent, 0, "equal scrolling either way must cancel out");
  assert.equal(carried, 0);
});
