import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MemoryBucketStore,
  RateLimiter,
  refill,
  tryConsume,
  type BucketPolicy,
} from "./limiter.ts";

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
  // Short by 5 tokens at 5/sec is exactly one second.
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

  // Bucket is empty; advancing the clock is what lets the next call through.
  now = 1_000;
  await limiter.acquire(key, policy, 5);
});
