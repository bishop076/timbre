import assert from "node:assert/strict";
import { test } from "node:test";

import { createCache } from "./cache.ts";

function clock(start = 0) {
  let at = start;
  return { now: () => at, advance: (ms: number) => (at += ms) };
}

test("a repeat within the TTL skips upstream, and an expired entry is fetched again", async () => {
  const time = clock();
  const cache = createCache<number>({ ttlMs: 1000, max: 10, now: time.now });
  let calls = 0;
  const produce = async () => ++calls;

  assert.equal(await cache.take("q", produce), 1);
  assert.equal(await cache.take("q", produce), 1);
  time.advance(1001);
  assert.equal(await cache.take("q", produce), 2);
});

test("concurrent misses of the same key share one upstream call", async () => {
  const cache = createCache<string>({ ttlMs: 1000, max: 10, now: clock().now });
  let calls = 0;

  let release: (value: string) => void = () => {};
  const gate = new Promise<string>((resolve) => (release = resolve));
  const produce = () => {
    calls += 1;
    return gate;
  };

  const all = Promise.all(Array.from({ length: 10 }, () => cache.take("q", produce)));
  release("one call");
  const results = await all;

  assert.equal(calls, 1, "this is the case the cache exists for");
  assert.deepEqual(new Set(results), new Set(["one call"]));
});

test("different keys do not share a call", async () => {
  const cache = createCache<string>({ ttlMs: 1000, max: 10, now: clock().now });
  let calls = 0;
  const produce = async () => `result ${++calls}`;

  await Promise.all([cache.take("a", produce), cache.take("b", produce)]);
  assert.equal(calls, 2);
});

test("a rejection is not cached, and the next attempt retries", async () => {
  const cache = createCache<string>({ ttlMs: 1000, max: 10, now: clock().now });
  let calls = 0;

  await assert.rejects(
    cache.take("q", async () => {
      calls += 1;
      throw new Error("deezer is down");
    }),
  );

  assert.equal(cache.size, 0, "a failed source must not be remembered as an answer");
  assert.equal(await cache.take("q", async () => "recovered"), "recovered");
  assert.equal(calls, 1);
});

test("the entry count stays under the cap", async () => {
  const cache = createCache<string>({ ttlMs: 10_000, max: 3, now: clock().now });

  for (const key of ["a", "b", "c", "d", "e"]) {
    await cache.take(key, async () => key);
  }

  assert.equal(cache.size, 3);
  assert.equal(await cache.take("e", async () => "refetched"), "e");
});
