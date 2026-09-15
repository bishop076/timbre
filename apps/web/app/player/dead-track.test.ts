import assert from "node:assert/strict";
import { test } from "node:test";

import { judgeDeadTrack, MOST_SKIPS, type DeadTrack } from "./dead-track.ts";

// The bug this file exists for: a saved playlist whose third song's stream id has rotted, played
// through from the top. The queue reached it on its own, nothing has been skipped yet, and there
// are more songs after it.
const ROTTED: DeadTrack = { chosenByHand: false, skipped: 0, queued: 8 };

const facts = (over: Partial<DeadTrack>): DeadTrack => ({ ...ROTTED, ...over });

test("steps over a dead track the queue reached by itself", () => {
  assert.equal(judgeDeadTrack(ROTTED), "skip");
});

test("keeps stepping while the run is shorter than the queue", () => {
  assert.equal(judgeDeadTrack(facts({ skipped: 1 })), "skip");
  assert.equal(judgeDeadTrack(facts({ skipped: 7 })), "skip");
});

test("stops after one pass of the queue", () => {
  // Eight dead songs on `repeat: "all"` is eight attempts, not an endless loop.
  assert.equal(judgeDeadTrack(facts({ skipped: 8 })), "stop");
  assert.equal(judgeDeadTrack(facts({ skipped: 9 })), "stop");
});

test("caps a long queue rather than grinding through all of it", () => {
  const long = { chosenByHand: false, queued: 500 };
  assert.equal(judgeDeadTrack({ ...long, skipped: MOST_SKIPS - 1 }), "skip");
  assert.equal(judgeDeadTrack({ ...long, skipped: MOST_SKIPS }), "stop");
});

test("leaves a hand-picked source showing its own failure", () => {
  // "Play from SoundCloud" on one song. Jumping to the next track would read as the press
  // having silently done something else.
  assert.equal(judgeDeadTrack(facts({ chosenByHand: true })), "stop");
  assert.equal(judgeDeadTrack(facts({ chosenByHand: true, skipped: 0, queued: 50 })), "stop");
});

test("stops on a queue with nowhere to go", () => {
  assert.equal(judgeDeadTrack(facts({ queued: 1 })), "stop");
  assert.equal(judgeDeadTrack(facts({ queued: 0 })), "stop");
});
