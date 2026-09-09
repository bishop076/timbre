import assert from "node:assert/strict";
import { test } from "node:test";

import { interleaveBy, rotationBucket, seededShuffle } from "./rotation.ts";

test("everyone inside one period shares a bucket, and the next period moves on", () => {
  const hour = 3_600_000;
  assert.equal(rotationBucket(10 * hour, hour), rotationBucket(10 * hour + hour - 1, hour));
  assert.equal(rotationBucket(11 * hour, hour), rotationBucket(10 * hour, hour) + 1);
});

test("a seeded shuffle deals the same hand for the same seed — server and browser agree", () => {
  const items = Array.from({ length: 25 }, (_, index) => index);
  assert.deepEqual(seededShuffle(items, 42), seededShuffle(items, 42));
});

test("a seeded shuffle is a permutation and leaves its input alone", () => {
  const items = Array.from({ length: 25 }, (_, index) => index);
  const shuffled = seededShuffle(items, 7);
  assert.deepEqual([...shuffled].sort((a, b) => a - b), items);
  assert.deepEqual(items, Array.from({ length: 25 }, (_, index) => index));
});

test("consecutive seeds give different orders, which is the whole point of rotating", () => {
  const items = Array.from({ length: 25 }, (_, index) => index);
  const orders = new Set(
    Array.from({ length: 10 }, (_, seed) => seededShuffle(items, seed).join(",")),
  );
  assert.equal(orders.size, 10);
});

test("interleaving takes one from each list in turn and drops repeats", () => {
  const merged = interleaveBy(
    [
      ["a1", "a2", "shared"],
      ["b1", "shared", "b3"],
    ],
    (item) => item,
    10,
  );
  assert.deepEqual(merged, ["a1", "b1", "a2", "shared", "b3"]);
});

test("interleaving stops at the limit and survives lists of different lengths", () => {
  assert.deepEqual(interleaveBy([["a1"], ["b1", "b2", "b3"]], (item) => item, 3), ["a1", "b1", "b2"]);
  assert.deepEqual(interleaveBy([], (item: string) => item, 3), []);
});
