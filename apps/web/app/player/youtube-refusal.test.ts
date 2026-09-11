import assert from "node:assert/strict";
import { test } from "node:test";

import { REFUSALS_BEFORE_LEAVING, turnedAway } from "./youtube-refusal.ts";

test("no refusal yet, or one that is still the upload's own, is not a verdict", () => {
  assert.equal(turnedAway({ stalled: false, refusals: 0 }), false);
  assert.equal(turnedAway({ stalled: false, refusals: 1 }), false);
});

test("a stall, or different uploads refused in a row, turns YouTube away", () => {
  assert.equal(turnedAway({ stalled: true, refusals: 0 }), true);
  assert.equal(turnedAway({ stalled: false, refusals: REFUSALS_BEFORE_LEAVING }), true);
  assert.equal(turnedAway({ stalled: false, refusals: 5 }), true);
});
