import assert from "node:assert/strict";
import { test } from "node:test";

import { refusalFor, refusalLine, SPOTIFY_REFUSAL, type SpotifyRefusal } from "./failures.ts";

test("the same status is read differently at the two endpoints", () => {
  // 403 is the development-mode allowlist at /v1/search and Premium-only at the player, and
  // telling someone to buy Premium because a search was refused is worse than saying nothing.
  assert.equal(refusalFor(403, "search"), "app-full");
  assert.equal(refusalFor(403, "playback"), "premium-required");
  assert.equal(refusalFor(404, "playback"), "region-restricted");
  assert.equal(refusalFor(404, "search"), "refused");
});

test("an expired token and a rate limit are never the same sentence", () => {
  assert.equal(refusalFor(401, "search"), "signed-out");
  assert.equal(refusalFor(429, "search"), "rate-limited");
  assert.notEqual(refusalLine("signed-out"), refusalLine("rate-limited"));
});

test("every refusal says a different thing", () => {
  const lines = Object.keys(SPOTIFY_REFUSAL).map((key) => refusalLine(key as SpotifyRefusal));
  assert.equal(new Set(lines).size, lines.length, "no two refusals collapse into one message");
});

test("no refusal is a bare status code", () => {
  for (const [key, { title, detail }] of Object.entries(SPOTIFY_REFUSAL)) {
    assert.doesNotMatch(title, /\d{3}/, `${key} leaks a status code into its headline`);
    assert.ok(detail.length > 40, `${key} says nothing a reader can act on`);
  }
});
