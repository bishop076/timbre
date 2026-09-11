import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryBucketStore, RateLimiter, refill, tryConsume, type BucketPolicy } from "./limiter.ts";

const policy: BucketPolicy = { capacity: 10, refillPerSecond: 5 };

test("refill accrues tokens over time and clamps at capacity", () => {
  const start = { tokens: 0, updatedAtMs: 0 };
  assert.equal(refill(start, policy, 1_000).tokens, 5);
  assert.equal(refill(start, policy, 10_000).tokens, 10, "must not exceed capacity");
});

test("tryConsume spends tokens when available", () => {
  const result = tryConsume({ tokens: 10, updatedAtMs: 0 }, policy, 3, 0);
  assert.ok(result.ok);
  assert.equal(result.state.tokens, 7);
});

test("tryConsume reports exactly how long to wait", () => {
  const result = tryConsume({ tokens: 1, updatedAtMs: 0 }, policy, 6, 0);
  assert.ok(!result.ok);
  assert.equal(result.waitMs, 1_000);
});

test("a request larger than capacity throws instead of hanging forever", () => {
  assert.throws(() => tryConsume({ tokens: 10, updatedAtMs: 0 }, policy, 11, 0), RangeError);
});

test("acquire spends from a persisted bucket", async () => {
  let now = 0;
  const limiter = new RateLimiter(new MemoryBucketStore(), () => now);
  const key = "conn:1";

  for (let i = 0; i < 10; i++) await limiter.acquire(key, policy, 1);

  now = 1_000;
  await limiter.acquire(key, policy, 5);
});

test("concurrent acquisitions on one key are paced, not all admitted at once", async () => {
  const limiter = new RateLimiter(new MemoryBucketStore());
  const policy = { capacity: 2, refillPerSecond: 10 };

  let admitted = 0;
  const all = Promise.all(
    [1, 2, 3].map(() =>
      limiter.acquire("apple", policy).then(() => {
        admitted += 1;
      }),
    ),
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(admitted, 2, "a two-token bucket admitted more than two callers at once");

  await all;
  assert.equal(admitted, 3);
});

test("a failed acquisition does not stall the callers queued behind it", async () => {
  const limiter = new RateLimiter(new MemoryBucketStore());
  const policy = { capacity: 2, refillPerSecond: 10 };

  await assert.rejects(limiter.acquire("k", policy, 3), RangeError);
  await limiter.acquire("k", policy);
});
