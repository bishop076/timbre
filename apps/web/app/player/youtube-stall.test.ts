import assert from "node:assert/strict";
import { test } from "node:test";

import { stalledAt } from "./youtube-stall.ts";

const UNSTARTED = -1;
const ENDED = 0;
const PLAYING = 1;
const PAUSED = 2;
const BUFFERING = 3;
const CUED = 5;

test("the measured stall: still trying, nothing buffered, position at zero", () => {
  assert.equal(stalledAt(BUFFERING, 0, 0), true);
  assert.equal(stalledAt(UNSTARTED, 0, 0), true);
});

test("a slow start that has buffered anything is not a stall", () => {
  assert.equal(stalledAt(BUFFERING, 0.004, 0), false);
  assert.equal(stalledAt(UNSTARTED, 0.5, 0), false);
});

test("a position past zero means it played, even while rebuffering", () => {
  assert.equal(stalledAt(BUFFERING, 0, 12.5), false);
});

test("settled states are never stalls, whatever the numbers say", () => {
  for (const state of [PLAYING, PAUSED, CUED, ENDED]) {
    assert.equal(stalledAt(state, 0, 0), false, `state ${state}`);
  }
});

test("a state the API never documented is not a stall either", () => {
  assert.equal(stalledAt(Number.NaN, 0, 0), false);
  assert.equal(stalledAt(42, 0, 0), false);
});
