import assert from "node:assert/strict";
import { test } from "node:test";

import { mapPool } from "./pool.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

test("results keep the order of their inputs, whatever order they finish in", async () => {
  const input = [5, 4, 3, 2, 1];
  const out = await mapPool(input, 2, async (value) => {
    for (let i = 0; i < value; i++) await tick();
    return value * 10;
  });
  assert.deepEqual(out, [50, 40, 30, 20, 10]);
});

test("never more than the limit are in flight", async () => {
  let live = 0;
  let peak = 0;

  await mapPool(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
    live += 1;
    peak = Math.max(peak, live);
    await tick();
    live -= 1;
  });

  assert.equal(peak, 4);
});

test("a shorter list than the limit is just Promise.all", async () => {
  assert.deepEqual(await mapPool([1, 2], 8, async (n) => n + 1), [2, 3]);
});

test("an empty list is no work at all", async () => {
  let calls = 0;
  assert.deepEqual(
    await mapPool([], 4, async () => {
      calls += 1;
      return 1;
    }),
    [],
  );
  assert.equal(calls, 0);
});
