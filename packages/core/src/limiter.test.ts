import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryBucketStore, RateLimiter, refill, reserve, type BucketPolicy } from "./limiter.ts";

const policy: BucketPolicy = { capacity: 10, refillPerSecond: 5 };
const tight: BucketPolicy = { capacity: 2, refillPerSecond: 10 };

test("refill accrues tokens over time and clamps at capacity", () => {
  const start = { tokens: 0, updatedAtMs: 0 };
  assert.equal(refill(start, policy, 1_000).tokens, 5);
  assert.equal(refill(start, policy, 10_000).tokens, 10, "must not exceed capacity");
});

test("reserve spends tokens when available, or books the debt and reports exactly how long to wait", () => {
  const spent = reserve({ tokens: 10, updatedAtMs: 0 }, policy, 3, 0);
  assert.deepEqual(spent, { state: { tokens: 7, updatedAtMs: 0 }, waitMs: 0 });

  const short = reserve({ tokens: 1, updatedAtMs: 0 }, policy, 6, 0);
  assert.equal(short.waitMs, 1_000);
  assert.equal(short.state.tokens, -5);
});

test("a request larger than capacity throws instead of hanging forever", () => {
  assert.throws(() => reserve({ tokens: 10, updatedAtMs: 0 }, policy, 11, 0), RangeError);
});

test("acquire spends from a persisted bucket", async () => {
  let now = 0;
  const limiter = new RateLimiter(new MemoryBucketStore(), () => now);
  for (let i = 0; i < 10; i++) await limiter.acquire("conn:1", policy);
  now = 1_000;
  await limiter.acquire("conn:1", policy, { cost: 5 });
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
  await assert.rejects(limiter.acquire("k", tight, { cost: 3 }), RangeError);
  await limiter.acquire("k", tight);
});

test("a caller whose slot is further off than it will wait is turned away at once, spending nothing", async () => {
  const limiter = new RateLimiter(new MemoryBucketStore(), () => 0);
  await limiter.acquire("apple", tight);
  await limiter.acquire("apple", tight);

  const started = performance.now();
  assert.equal(await limiter.acquire("apple", tight, { maxWaitMs: 50 }), false);
  assert.ok(performance.now() - started < 50, "the refusal waited instead of answering at once");

  assert.equal(await limiter.acquire("apple", tight, { maxWaitMs: 100 }), true);
});

test("an aborted wait ends at once and hands its slot back", async () => {
  const limiter = new RateLimiter(new MemoryBucketStore(), () => 0);
  await limiter.acquire("apple", tight);
  await limiter.acquire("apple", tight);

  const controller = new AbortController();
  const waiting = limiter.acquire("apple", tight, { signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(waiting, { name: "AbortError" });

  assert.equal(await limiter.acquire("apple", tight, { maxWaitMs: 100 }), true);
  await assert.rejects(limiter.acquire("apple", tight, { signal: AbortSignal.abort() }), { name: "AbortError" });
  assert.equal(await limiter.acquire("apple", tight, { maxWaitMs: 150 }), false);
});
