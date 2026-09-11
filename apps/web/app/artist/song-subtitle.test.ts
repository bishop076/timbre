import assert from "node:assert/strict";
import { test } from "node:test";

import { albumAddsSomething } from "./song-subtitle.ts";

test("a single's album repeats its title and is not worth printing", () => {
  assert.equal(albumAddsSomething("This Was Your Song - Single", "This Was Your Song"), false);
  assert.equal(albumAddsSomething("Toonami - EP", "Toonami"), false);
  assert.equal(albumAddsSomething("Inside (feat. Shogonodo)", "Inside (feat. Shogonodo)"), false);
  assert.equal(albumAddsSomething("Nausicaä", "Nausicaa"), false);
});

test("a real release is worth printing", () => {
  assert.equal(albumAddsSomething("Just Another Day EP", "Another Love Song for Nobody"), true);
  assert.equal(albumAddsSomething("After All This Time", "City Pop"), true);
});

test("no album is nothing to print", () => {
  assert.equal(albumAddsSomething(null, "2AM IN BOSTON"), false);
  assert.equal(albumAddsSomething("", "2AM IN BOSTON"), false);
});
