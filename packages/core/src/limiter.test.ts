import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryBucketStore, RateLimiter, refill, tryConsume, type BucketPolicy } from "./limiter.ts";

const policy: BucketPolicy = { capacity: 10, refillPerSecond: 5 };
const tight: BucketPolicy = { capacity: 2, refillPerSecond: 10 };

test("refill accrues tokens over time and clamps at capacity", () => {
  const start = { tokens: 0, updatedAtMs: 0 };
  assert.equal(refill(start, policy, 1_000).tokens, 5);
  assert.equal(refill(start, policy, 10_000).tokens, 10, "must not exceed capacity");
});

test("tryConsume spends tokens when available, or reports exactly how long to wait", () => {
  const spent = tryConsume({ tokens: 10, updatedAtMs: 0 }, policy, 3, 0);
  assert.ok(spent.ok);
  assert.equal(spent.state.tokens, 7);

  const short = tryConsume({ tokens: 1, updatedAtMs: 0 }, policy, 6, 0);
  assert.ok(!short.ok);
  assert.equal(short.waitMs, 1_000);
});

test("a request larger than capacity throws instead of hanging forever", () => {
  assert.throws(() => tryConsume({ tokens: 10, updatedAtMs: 0 }, policy, 11, 0), RangeError);
});

test("acquire spends from a persisted bucket", async () => {
  let now = 0;
  const limiter = new RateLimiter(new MemoryBucketStore(), () => now);
  for (let i = 0; i < 10; i++) await limiter.acquire("conn:1", policy, 1);
  now = 1_000;
  await limiter.acquire("conn:1", policy, 5);
});

test("concurrent acquisitions on one key are paced, not all admitted at once", async () => {
  const limiter = new RateLimiter(new MemoryBucketStore());
  let admitted = 0;
  const all = Promise.all(
    [1, 2, 3].map(() => limiter.acquire("apple", tight).then(() => (admitted += 1))),
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(admitted, 2, "a two-token bucket admitted more than two callers at once");
  await all;
  assert.equal(admitted, 3);
});

test("a failed acquisition does not stall the callers queued behind it", async () => {
  const limiter = new RateLimiter(new MemoryBucketStore());
  await assert.rejects(limiter.acquire("k", tight, 3), RangeError);
  await limiter.acquire("k", tight);
});
