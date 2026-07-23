import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError } from "./errors.ts";
import {
  MemoryBucketStore,
  RateLimiter,
  classify429,
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

test("classify429 distinguishes an exhausted quota from a throttle", () => {
  const quota = classify429(429, new Headers(), { error: { reason: "QUOTA_EXCEEDED" } });
  assert.equal(quota.kind, "quota");

  const throttled = classify429(429, new Headers({ "retry-after": "30" }), {});
  assert.deepEqual(throttled, { kind: "rate", retryAfterMs: 30_000 });
});

test("classify429 handles an HTTP-date Retry-After", () => {
  const now = Date.parse("2026-08-14T12:00:00Z");
  const headers = new Headers({ "retry-after": "Fri, 14 Aug 2026 12:00:30 GMT" });
  const outcome = classify429(429, headers, {}, now);
  assert.deepEqual(outcome, { kind: "rate", retryAfterMs: 30_000 });
});

test("classify429 backs off by default when given no hint", () => {
  const outcome = classify429(429, new Headers(), {});
  assert.deepEqual(outcome, { kind: "rate", retryAfterMs: 5_000 });
});

test("non-429 responses are not limit outcomes", () => {
  assert.deepEqual(classify429(500, new Headers(), {}), { kind: "none" });
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

test("an exhausted quota raises a non-retryable error", async () => {
  const limiter = new RateLimiter(new MemoryBucketStore());
  await assert.rejects(
    () => limiter.penalize("conn:1", "spotify", { kind: "quota", resetAt: undefined }),
    (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.kind, "quota_exceeded");
      assert.equal(error.retryable, false, "retrying an exhausted quota just burns tomorrow's budget");
      return true;
    },
  );
});
