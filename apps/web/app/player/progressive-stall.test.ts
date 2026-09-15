import assert from "node:assert/strict";
import { test } from "node:test";

import { stalledStart, START_DEADLINE_MS } from "./progressive-stall.ts";

// The four HTMLMediaElement readyStates, by their spec names.
const NOTHING = 0;
const METADATA = 1;
const CURRENT_DATA = 2;
const FUTURE_DATA = 3;

const media = (over: Partial<Parameters<typeof stalledStart>[0]> = {}) => ({
  paused: false,
  readyState: NOTHING,
  currentTime: 0,
  ...over,
});

test("the measured stall: playing was asked for, and nothing at all came back", () => {
  assert.equal(stalledStart(media()), true);
  assert.equal(stalledStart(media({ readyState: METADATA })), true, "headers are not audio");
});

test("a byte of audio, or a position past zero, means it is not a stall", () => {
  assert.equal(stalledStart(media({ readyState: CURRENT_DATA })), false);
  assert.equal(stalledStart(media({ readyState: FUTURE_DATA })), false);
  assert.equal(stalledStart(media({ currentTime: 0.2 })), false);
});

test("an element the browser refused to autoplay is paused, not stalled", () => {
  // `NotAllowedError` already reports a pause. Reporting it again as a dead stream would walk
  // the ladder off a source that is fine and waiting for a click.
  assert.equal(stalledStart(media({ paused: true })), false);
  assert.equal(stalledStart(media({ paused: true, readyState: NOTHING })), false);
});

test("the deadline leaves room for a slow first byte", () => {
  assert.ok(START_DEADLINE_MS >= 8000);
});
