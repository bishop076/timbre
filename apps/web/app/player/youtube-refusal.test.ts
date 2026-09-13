import assert from "node:assert/strict";
import { test } from "node:test";

import { REFUSALS_BEFORE_LEAVING, whyLeftYouTube } from "./youtube-refusal.ts";

const clean = { blocked: false, stalled: false, refusals: 0 };

test("no refusal yet, or one that is still the upload's own, is not a verdict", () => {
  assert.equal(whyLeftYouTube(clean), null);
  assert.equal(whyLeftYouTube({ ...clean, refusals: 1 }), null);
});

test("a stall, or different uploads refused in a row, turns YouTube away", () => {
  assert.equal(whyLeftYouTube({ ...clean, stalled: true }), "refused");
  assert.equal(whyLeftYouTube({ ...clean, refusals: REFUSALS_BEFORE_LEAVING }), "refused");
  assert.equal(whyLeftYouTube({ ...clean, refusals: 5 }), "refused");
});

test("a blocked player script is its own verdict, and outranks the rest", () => {
  // The ladder must leave YouTube outright: with no player object a second copy never reports.
  assert.equal(whyLeftYouTube({ ...clean, blocked: true }), "blocked");
  assert.equal(whyLeftYouTube({ blocked: true, stalled: true, refusals: 5 }), "blocked");
});
