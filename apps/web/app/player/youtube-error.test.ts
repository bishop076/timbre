import assert from "node:assert/strict";
import { test } from "node:test";

import { REFUSED, youtubeError } from "./youtube-error.ts";

test("a code nobody listed still leaves the ladder somewhere to go", () => {
  // 2 is documented — an invalid video id — and was the one documented code with no entry.
  for (const code of [2, 4, 42, 153_000, Number.NaN]) {
    const verdict = youtubeError(code);
    assert.equal(verdict.worthRetrying, true, `error ${code}`);
    assert.equal(verdict.refused, false, `error ${code} is not a refusal to embed`);
    assert.ok(verdict.reason.length > 0, `error ${code} says something`);
  }
});

test("the three ways YouTube says “not here” are counted as refusals", () => {
  for (const code of [101, 150, 153]) {
    assert.deepEqual(youtubeError(code), { reason: REFUSED, worthRetrying: true, refused: true });
  }
});

test("a removed upload and a player failure are retried, but are not refusals", () => {
  assert.deepEqual(youtubeError(100), {
    reason: "That upload has been removed.",
    worthRetrying: true,
    refused: false,
  });
  assert.equal(youtubeError(5).refused, false);
  assert.equal(youtubeError(5).worthRetrying, true);
});

test("an unknown code names its number, so the log panel can be read against YouTube's", () => {
  assert.match(youtubeError(2_000).reason, /2000/);
});
