import assert from "node:assert/strict";
import { test } from "node:test";

import { creditNames } from "./credits.ts";

test("the artist themselves, however the name is punctuated", () => {
  assert.equal(creditNames("le real", "Lé Real"), true);
  assert.equal(creditNames("Lé Real", "Lé Real"), true);
});

test("a guest spot on someone else's record still counts", () => {
  assert.equal(creditNames("le real", "Cozy Collective, Lé Real & HYESUNG"), true);
  assert.equal(creditNames("le real", "Lé Real & Broadway"), true);
});

test("an artist whose name is a fragment of the one searched is refused", () => {
  // Reported: `Real (feat. Slim Thug, Z-Ro & MUG)` by Le$ appeared second on Lé Real's page.
  // `Le$` normalizes to `le`, and the old filter asked whether "le real" contained it.
  assert.equal(creditNames("le real", "Le$"), false);
  assert.equal(creditNames("le real", "Real Boston Richey"), false);
  assert.equal(creditNames("le real", "Real McCoy"), false);
});

test("a longer billing containing the whole name is kept", () => {
  // What the removed arm was actually reaching for.
  assert.equal(creditNames("le real", "Lé Real Music"), true);
  // ...but not a name that merely starts with the same letters.
  assert.equal(creditNames("le real", "Lé Realism"), false);
});
