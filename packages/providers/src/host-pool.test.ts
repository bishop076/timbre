import assert from "node:assert/strict";
import { test } from "node:test";

import { createHostPool } from "./host-pool.ts";

const HOSTS = ["https://a.test", "https://b.test", "https://c.test"];

/** A clock the test moves by hand, so a cool-down can expire without waiting for it. */
function clock(start = 1_000) {
  let at = start;
  return { now: () => at, advance: (ms: number) => (at += ms) };
}

test("a healthy pool is asked in the listed order", () => {
  const pool = createHostPool(HOSTS, 60_000);
  assert.deepEqual(pool.order(), HOSTS);
});

test("a host that failed is asked last until its cool-down ends", () => {
  const time = clock();
  const pool = createHostPool(HOSTS, 60_000, time.now);

  pool.down("https://a.test");
  assert.deepEqual(pool.order(), ["https://b.test", "https://c.test", "https://a.test"]);

  time.advance(59_999);
  assert.equal(pool.order()[0], "https://b.test", "still cooling a millisecond before the end");

  time.advance(1);
  assert.deepEqual(pool.order(), HOSTS, "back at the front once the cool-down has run out");
});

test("with every host cooling, the soonest to recover leads — none is dropped", () => {
  // Demoted rather than removed: a pool that refused to ask anyone would turn one bad minute
  // into a minute of Audius missing from every search, even after it had recovered.
  const time = clock();
  const pool = createHostPool(HOSTS, 60_000, time.now);

  pool.down("https://b.test");
  time.advance(10);
  pool.down("https://a.test");
  time.advance(10);
  pool.down("https://c.test");

  assert.deepEqual(pool.order(), ["https://b.test", "https://a.test", "https://c.test"]);
});

test("a host that answers is cleared at once", () => {
  const time = clock();
  const pool = createHostPool(HOSTS, 60_000, time.now);

  pool.down("https://a.test");
  pool.up("https://a.test");
  assert.deepEqual(pool.order(), HOSTS);
});
