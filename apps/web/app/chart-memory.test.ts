import assert from "node:assert/strict";
import { test } from "node:test";

import { describeAge, movementOf, readSnapshot } from "./chart-memory.ts";

const DAY = 86_400_000;

test("a snapshot this browser wrote reads back whole", () => {
  const stored = { at: 1_700_000_000_000, positions: { a: 1, b: 12 } };
  assert.deepEqual(readSnapshot(stored), stored);
});

test("a time no Date can hold is not a time this store will print", () => {
  // `describeAge` puts `at` into a sentence under the movement arrows, and `now - at` is also
  // the clock deciding when today's positions replace yesterday's.
  assert.equal(readSnapshot({ at: 1e20, positions: {} }), null);
  assert.equal(readSnapshot({ at: 0, positions: {} }), null);
  assert.equal(readSnapshot({ at: -1, positions: {} }), null);
  assert.equal(readSnapshot({ at: "yesterday", positions: {} }), null);
  assert.equal(readSnapshot({ positions: {} }), null);
});

test("a position that is not a number is not a position", () => {
  assert.deepEqual(readSnapshot({ at: 5, positions: { a: 1, b: "2", c: null, d: {} } }), {
    at: 5,
    positions: { a: 1 },
  });
  // `Object.entries` of a list would have made every index a track id.
  assert.equal(readSnapshot({ at: 5, positions: [1, 2, 3] }), null);
  assert.equal(readSnapshot({ at: 5, positions: null }), null);
  assert.equal(readSnapshot(null), null);
  assert.equal(readSnapshot([{ at: 5, positions: {} }]), null);
});

test("movement is only reported against a position that was really stored", () => {
  const snapshot = readSnapshot({ at: 5, positions: { a: 4, b: Number.POSITIVE_INFINITY } });
  assert.equal(movementOf(snapshot, "a", 1), 3);
  assert.equal(movementOf(snapshot, "b", 1), null, "an unusable position moves nothing");
  assert.equal(movementOf(snapshot, "gone", 1), null);
});

test("the age of a snapshot reads as a length of time", () => {
  assert.equal(describeAge(Date.now()), "since earlier today");
  assert.equal(describeAge(Date.now() - DAY), "since yesterday");
  assert.equal(describeAge(Date.now() - 20 * DAY), "over 3 weeks");
});
