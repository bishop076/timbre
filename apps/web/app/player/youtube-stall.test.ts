import assert from "node:assert/strict";
import { test } from "node:test";

import { stalledAt } from "./youtube-stall.ts";

const STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

test("the measured stall: still trying, nothing buffered, position at zero", () => {
  assert.equal(stalledAt(STATE.BUFFERING, 0, 0), true);
  assert.equal(stalledAt(STATE.UNSTARTED, 0, 0), true);
});

test("anything buffered, or a position past zero, means it is not a stall", () => {
  assert.equal(stalledAt(STATE.BUFFERING, 0.004, 0), false);
  assert.equal(stalledAt(STATE.UNSTARTED, 0.5, 0), false);
  assert.equal(stalledAt(STATE.BUFFERING, 0, 12.5), false);
});

test("settled and undocumented states are never stalls, whatever the numbers say", () => {
  const { PLAYING, PAUSED, CUED, ENDED } = STATE;
  for (const state of [PLAYING, PAUSED, CUED, ENDED, Number.NaN, 42]) {
    assert.equal(stalledAt(state, 0, 0), false, `state ${state}`);
  }
});
