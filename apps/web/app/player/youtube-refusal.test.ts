import assert from "node:assert/strict";
import { test } from "node:test";

import { REFUSALS_BEFORE_LEAVING, turnedAway } from "./youtube-refusal.ts";

test("one refused upload is still the upload's: the next copy is worth a try", () => {
  assert.equal(turnedAway({ stalled: false, refusals: 1 }), false);
});

test("two different uploads refused in a row is the connection", () => {
  assert.equal(turnedAway({ stalled: false, refusals: REFUSALS_BEFORE_LEAVING }), true);
  assert.equal(turnedAway({ stalled: false, refusals: 5 }), true);
});

test("a stall turns YouTube away on the first copy", () => {
  assert.equal(turnedAway({ stalled: true, refusals: 0 }), true);
});

test("nothing refused yet is not a verdict", () => {
  assert.equal(turnedAway({ stalled: false, refusals: 0 }), false);
});
