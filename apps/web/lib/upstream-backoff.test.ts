import assert from "node:assert/strict";
import { test } from "node:test";

import { createBackoff, isBackoffSignal, parseRetryAfter } from "./upstream-backoff.ts";

const NOW = Date.parse("2026-09-11T10:00:00Z");

function setup() {
  let at = NOW;
  const backoff = createBackoff({ defaultSeconds: 30, maxSeconds: 600, now: () => at });
  return { backoff, advance: (ms: number) => (at += ms) };
}

const holds: [string, string | null, number][] = [
  ["the seconds Retry-After names", "120", 120],
  ["the time left until an HTTP-date", "Fri, 11 Sep 2026 10:01:30 GMT", 90],
  ["the default without a header", null, 30],
  ["the default for an empty header", "", 30],
  ["the default for a word", "soon", 30],
  ["the default for a fraction", "1.5", 30],
  ["the default for a negative", "-5", 30],
  ["the cap, so a misread header cannot silence the source for a day", "86400", 600],
  ["a second for 'retry now', rather than inviting a hot loop", "0", 1],
];

for (const [label, header, seconds] of holds) {
  test(`a refusal holds for ${label}`, () => {
    const { backoff } = setup();
    assert.equal(backoff.remainingSeconds(), 0);
    assert.equal(backoff.trip(header), seconds);
    assert.equal(backoff.remainingSeconds(), seconds);
  });
}

test("a hold lets go when it runs out, a part-second left still being a second", () => {
  const { backoff, advance } = setup();
  backoff.trip("120");
  advance(119_500);
  assert.equal(backoff.remainingSeconds(), 1);
  advance(500);
  assert.equal(backoff.remainingSeconds(), 0);
});

test("a later, shorter refusal does not cut an earlier, longer hold; a longer one extends it", () => {
  const { backoff, advance } = setup();
  backoff.trip("300");
  advance(10_000);
  assert.equal(backoff.trip("5"), 290, "the wait reported is the one actually in force");
  assert.equal(backoff.remainingSeconds(), 290);
  assert.equal(backoff.trip("600"), 600);
});

test("a 429 always means back off; a 503 only when it says for how long", () => {
  const cases: [number, string | null, boolean][] = [
    [429, null, true],
    [429, "30", true],
    [503, "30", true],
    [503, null, false],
    [503, " ", false],
    [404, "30", false],
    [200, "30", false],
  ];
  for (const [status, header, expected] of cases) {
    assert.equal(isBackoffSignal(status, header), expected, `${status} ${header}`);
  }
});

test("parseRetryAfter reads both forms and refuses the rest", () => {
  const cases: [string | null, number | null][] = [
    ["45", 45],
    [" 45 ", 45],
    ["Fri, 11 Sep 2026 10:00:10 GMT", 10],
    ["Fri, 11 Sep 2026 09:00:00 GMT", 0],
    [null, null],
    ["later", null],
  ];
  for (const [header, expected] of cases) {
    assert.equal(parseRetryAfter(header, NOW), expected, String(header));
  }
});
