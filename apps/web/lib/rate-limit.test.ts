import assert from "node:assert/strict";
import { test } from "node:test";

import { clientKey, createRateLimiter } from "./rate-limit.ts";

function clock(start = 0) {
  let at = start;
  return { now: () => at, advance: (ms: number) => (at += ms) };
}

test("requests inside the limit are allowed and count down", () => {
  const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: clock().now });

  for (const remaining of [2, 1, 0]) {
    assert.deepEqual(limiter.check("a"), { ok: true, remaining, retryAfterSeconds: 0 });
  }
});

test("the request past the limit is refused with a retry hint", () => {
  const time = clock();
  const limiter = createRateLimiter({ limit: 2, windowMs: 5000, now: time.now });

  limiter.check("a");
  limiter.check("a");
  time.advance(1000);

  const verdict = limiter.check("a");
  assert.equal(verdict.ok, false);
  assert.equal(verdict.retryAfterSeconds, 4, "what is left of the window, rounded up");

  time.advance(3999);
  assert.equal(limiter.check("a").retryAfterSeconds, 1, "a refusal never reports zero seconds");
});

test("the allowance returns when the window lapses", () => {
  const time = clock();
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: time.now });

  assert.equal(limiter.check("a").ok, true);
  assert.equal(limiter.check("a").ok, false);
  time.advance(1001);
  assert.equal(limiter.check("a").ok, true);
});

test("only the first refusal of a window is marked first", () => {
  const time = clock();
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: time.now });

  limiter.check("a");
  assert.equal(limiter.check("a").first, true);
  assert.equal(limiter.check("a").first, false);
  assert.equal(limiter.check("a").first, false);

  time.advance(1001);
  limiter.check("a");
  assert.equal(limiter.check("a").first, true, "a new window is a new event");
});

test("one client being throttled does not affect another", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: clock().now });

  assert.equal(limiter.check("noisy").ok, true);
  assert.equal(limiter.check("noisy").ok, false);
  assert.equal(limiter.check("quiet").ok, true, "throttling must be per client, not global");
});

test("lapsed clients are swept rather than evicting live ones", () => {
  const time = clock();
  const limiter = createRateLimiter({ limit: 5, windowMs: 1000, max: 3, now: time.now });

  limiter.check("a");
  limiter.check("b");
  limiter.check("c");
  assert.equal(limiter.size, 3);

  time.advance(1001);
  limiter.check("d");
  assert.equal(limiter.size, 1);
});

test("the tracked-client count stays under the cap", () => {
  const limiter = createRateLimiter({ limit: 5, windowMs: 10_000, max: 3, now: clock().now });

  for (const key of ["a", "b", "c", "d", "e", "f"]) limiter.check(key);
  assert.ok(limiter.size <= 3, `expected at most 3 tracked clients, got ${limiter.size}`);
});

test("the client is the first x-forwarded-for entry, then x-real-ip, then a constant", () => {
  const key = (headers: Record<string, string>) =>
    clientKey(new Request("https://timbre.example/api/search", { headers }));

  const forwarded = { "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178" };
  assert.equal(key(forwarded), "203.0.113.7");
  assert.equal(key({ "x-real-ip": "203.0.113.9" }), "203.0.113.9");
  assert.equal(key({}), "unknown");
});
