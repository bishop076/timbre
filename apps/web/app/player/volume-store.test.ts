import assert from "node:assert/strict";
import { test } from "node:test";

import { parseVolume } from "./volume-store.ts";

test("a level written out as digits is the level", () => {
  assert.equal(parseVolume("0"), 0);
  assert.equal(parseVolume("35"), 35);
  assert.equal(parseVolume("100"), 100);
  assert.equal(parseVolume("62.5"), 62.5);
  assert.equal(parseVolume(" 40 "), 40);
});

test("an empty value is not a volume of zero", () => {
  // `Number("")` is 0, so this used to come back as a valid level: the app started silent with
  // the slider at the bottom, indistinguishable from a broken player, and the next write made
  // the zero permanent.
  assert.equal(parseVolume(""), 100);
  assert.equal(parseVolume("   "), 100);
  assert.equal(parseVolume("\n"), 100);
});

test("nothing else counts as a level either", () => {
  assert.equal(parseVolume(null), 100);
  assert.equal(parseVolume("0x40"), 100, "hex is a number to Number() and to nobody else");
  assert.equal(parseVolume("1e1"), 100);
  assert.equal(parseVolume("loud"), 100);
  assert.equal(parseVolume("-5"), 100);
  assert.equal(parseVolume("101"), 100);
  assert.equal(parseVolume("Infinity"), 100);
});
