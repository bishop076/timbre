import assert from "node:assert/strict";
import { test } from "node:test";

import { createHostPool } from "./host-pool.ts";

const HOSTS = ["https://a.test", "https://b.test", "https://c.test"];
const [A, B, C] = HOSTS as [string, string, string];

function setup() {
  let at = 1_000;
  return { pool: createHostPool(HOSTS, 60_000, () => at), advance: (ms: number) => (at += ms) };
}

test("a healthy pool is asked in the listed order, and a host that answers is cleared at once", () => {
  const { pool } = setup();
  assert.deepEqual(pool.order(), HOSTS);
  pool.down(A);
  pool.up(A);
  assert.deepEqual(pool.order(), HOSTS);
});

test("a host that failed is asked last until its cool-down ends", () => {
  const { pool, advance } = setup();
  pool.down(A);
  assert.deepEqual(pool.order(), [B, C, A]);

  advance(59_999);
  assert.equal(pool.order()[0], B, "still cooling a millisecond before the end");
  advance(1);
  assert.deepEqual(pool.order(), HOSTS, "back at the front once the cool-down has run out");
});

test("with every host cooling, the soonest to recover leads — none is dropped", () => {
  const { pool, advance } = setup();
  pool.down(B);
  advance(10);
  pool.down(A);
  advance(10);
  pool.down(C);
  assert.deepEqual(pool.order(), [B, A, C]);
});
