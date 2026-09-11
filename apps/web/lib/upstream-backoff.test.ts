import assert from "node:assert/strict";
import { test } from "node:test";

import { createBackoff, isBackoffSignal, parseRetryAfter } from "./upstream-backoff.ts";

function clock(start = 1_000_000) {
  let at = start;
  return { now: () => at, advance: (ms: number) => (at += ms) };
}

const options = { defaultSeconds: 30, maxSeconds: 600 };

test("a fresh backoff lets calls through", () => {
  const backoff = createBackoff({ ...options, now: clock().now });
  assert.equal(backoff.remainingSeconds(), 0);
});

test("a refusal holds for the seconds Retry-After names, then lets go", () => {
  const time = clock();
  const backoff = createBackoff({ ...options, now: time.now });

  assert.equal(backoff.trip("120"), 120);
  assert.equal(backoff.remainingSeconds(), 120);

  time.advance(119_500);
  assert.equal(backoff.remainingSeconds(), 1, "a part-second left is still a second to wait");

  time.advance(500);
  assert.equal(backoff.remainingSeconds(), 0);
});

test("an HTTP-date Retry-After is read as the time left until it", () => {
  const time = clock(Date.parse("2026-09-11T10:00:00Z"));
  const backoff = createBackoff({ ...options, now: time.now });

  assert.equal(backoff.trip("Fri, 11 Sep 2026 10:01:30 GMT"), 90);
});

test("a refusal without a readable Retry-After holds for the default", () => {
  for (const header of [null, "", "soon", "1.5", "-5"]) {
    const backoff = createBackoff({ ...options, now: clock().now });
    assert.equal(backoff.trip(header), 30, String(header));
  }
});

test("a hold is capped, so a misread header cannot silence the source for a day", () => {
  const backoff = createBackoff({ ...options, now: clock().now });
  assert.equal(backoff.trip("86400"), 600);
});

test("'retry now' still holds for a second rather than inviting a hot loop", () => {
  const backoff = createBackoff({ ...options, now: clock().now });
  assert.equal(backoff.trip("0"), 1);
  assert.equal(backoff.remainingSeconds(), 1);
});

test("a later, shorter refusal does not cut an earlier, longer hold", () => {
  const time = clock();
  const backoff = createBackoff({ ...options, now: time.now });

  backoff.trip("300");
  time.advance(10_000);
  assert.equal(backoff.trip("5"), 290, "the wait reported is the one actually in force");
  assert.equal(backoff.remainingSeconds(), 290);
});

test("a later, longer refusal extends the hold", () => {
  const time = clock();
  const backoff = createBackoff({ ...options, now: time.now });

  backoff.trip("10");
  time.advance(5_000);
  assert.equal(backoff.trip("60"), 60);
});

test("a 429 always means back off; a 503 only when it says for how long", () => {
  assert.equal(isBackoffSignal(429, null), true);
  assert.equal(isBackoffSignal(429, "30"), true);
  assert.equal(isBackoffSignal(503, "30"), true);
  assert.equal(isBackoffSignal(503, null), false, "a bare 503 is an outage, not a hold");
  assert.equal(isBackoffSignal(503, " "), false);
  assert.equal(isBackoffSignal(404, "30"), false);
  assert.equal(isBackoffSignal(200, "30"), false);
});

test("parseRetryAfter reads both forms and refuses the rest", () => {
  const now = Date.parse("2026-09-11T10:00:00Z");
  assert.equal(parseRetryAfter("45", now), 45);
  assert.equal(parseRetryAfter(" 45 ", now), 45);
  assert.equal(parseRetryAfter("Fri, 11 Sep 2026 10:00:10 GMT", now), 10);
  assert.equal(parseRetryAfter("Fri, 11 Sep 2026 09:00:00 GMT", now), 0, "a date already past");
  assert.equal(parseRetryAfter(null, now), null);
  assert.equal(parseRetryAfter("later", now), null);
});
