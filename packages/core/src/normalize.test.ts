import assert from "node:assert/strict";
import { test } from "node:test";

import { dedupeKey, durationsMatch, normalizeArtists, parseTitle } from "./normalize.ts";

test("strips noise that does not change the recording", () => {
  const variations = [
    "Bohemian Rhapsody",
    "Bohemian Rhapsody (Remastered 2011)",
    "Bohemian Rhapsody - 2011 Remaster",
    "Bohemian Rhapsody (Official Video)",
    "Bohemian Rhapsody [HD]",
  ];
  const bases = new Set(variations.map((title) => parseTitle(title).base));
  assert.equal(bases.size, 1, `expected one base, got ${[...bases].join(" | ")}`);
  assert.equal([...bases][0], "bohemian rhapsody");
});

test("keeps variant markers so a live cut never matches the studio take", () => {
  const studio = parseTitle("Redbone");
  const live = parseTitle("Redbone (Live)");
  const remix = parseTitle("Redbone - Kaytranada Remix");

  assert.equal(studio.base, live.base, "base title should be shared");
  assert.deepEqual(studio.variants, []);
  assert.deepEqual(live.variants, ["live"]);
  assert.deepEqual(remix.variants, ["remix"]);

  // The whole point: these must not collapse together.
  assert.notEqual(dedupeKey("Redbone", ["Childish Gambino"]), dedupeKey("Redbone (Live)", ["Childish Gambino"]));
});

test("keeps unrecognized bracketed text as a distinguishing variant", () => {
  // Regression: "(Unplugged)" was silently discarded, making an unplugged
  // recording identical to the studio one. The variant list can never be
  // complete, so anything unrecognized must distinguish rather than vanish.
  const studio = parseTitle("Wonderwall");
  const unplugged = parseTitle("Wonderwall (Unplugged)");
  const mystery = parseTitle("Wonderwall (Glastonbury 1995)");

  assert.equal(studio.base, unplugged.base, "base title is shared");
  assert.deepEqual(studio.variants, []);
  assert.notDeepEqual(unplugged.variants, [], "unplugged must not look like the studio take");
  assert.notDeepEqual(mystery.variants, [], "an unknown parenthetical must still distinguish");

  assert.notEqual(dedupeKey("Wonderwall", ["Oasis"]), dedupeKey("Wonderwall (Unplugged)", ["Oasis"]));
  assert.notEqual(
    dedupeKey("Wonderwall", ["Oasis"]),
    dedupeKey("Wonderwall (Glastonbury 1995)", ["Oasis"]),
  );
});

test("still ignores pure noise inside brackets", () => {
  // The new rule must not defeat noise stripping: these reduce to nothing.
  for (const title of [
    "Wonderwall (Remastered 2011)",
    "Wonderwall (Official Video)",
    "Wonderwall [HD]",
    "Wonderwall (Deluxe Edition)",
  ]) {
    assert.equal(
      dedupeKey(title, ["Oasis"]),
      dedupeKey("Wonderwall", ["Oasis"]),
      `${title} should match the plain title`,
    );
  }
});

test("pulls featured artists out of the title", () => {
  const parsed = parseTitle("Sunflower (feat. Swae Lee)");
  assert.equal(parsed.base, "sunflower");
  assert.deepEqual(parsed.featured, ["swae lee"]);
});

test("normalizes diacritics, ampersands and punctuation", () => {
  assert.deepEqual(normalizeArtists(["Beyoncé"]), ["beyonce"]);
  assert.deepEqual(normalizeArtists(["Simon & Garfunkel"]), ["garfunkel", "simon"]);
  assert.deepEqual(normalizeArtists(["Tyler, The Creator"]), ["the creator", "tyler"]);
});

test("dedupeKey ignores credit order and feat. placement", () => {
  const inTitle = dedupeKey("Sunflower (feat. Swae Lee)", ["Post Malone"]);
  const inArtists = dedupeKey("Sunflower", ["Post Malone", "Swae Lee"]);
  assert.equal(inTitle, inArtists);
});

test("duration tolerance absorbs provider disagreement but not real differences", () => {
  assert.ok(durationsMatch(201_000, 203_000), "2s apart is the same recording");
  assert.ok(!durationsMatch(201_000, 260_000), "a minute apart is not");
  assert.ok(durationsMatch(201_000, null), "unknown duration is not evidence against a match");
});
