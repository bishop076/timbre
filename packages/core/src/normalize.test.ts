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

  assert.notEqual(dedupeKey("Redbone", ["Childish Gambino"]), dedupeKey("Redbone (Live)", ["Childish Gambino"]));
});

test("keeps unrecognized bracketed text as a distinguishing variant", () => {
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

test("a bare 'with' mid-title is part of the title, not a guest credit", () => {
  for (const [title, base] of [
    ["Stay With Me", "stay with me"],
    ["Dancing With Myself", "dancing with myself"],
    ["The Girl With The Faraway Eyes", "the girl with the faraway eyes"],
  ] as const) {
    const parsed = parseTitle(title);
    assert.equal(parsed.base, base);
    assert.deepEqual(parsed.featured, [], `${title} credits nobody`);
  }
});

test("a bracketed 'with' is still the guest credit it plainly is", () => {
  const parsed = parseTitle("Save Your Tears (with Ariana Grande)");
  assert.equal(parsed.base, "save your tears");
  assert.deepEqual(parsed.featured, ["ariana grande"]);
  assert.deepEqual(parseTitle("Save Your Tears - with Ariana Grande").featured, ["ariana grande"]);
});

test("two songs sharing a prefix stay apart once 'with' stops truncating them", () => {
  assert.notEqual(dedupeKey("Stay", ["Sam Smith"]), dedupeKey("Stay With Me", ["Sam Smith"]));
});

test("a guest credit inside a bracket does not erase the variant beside it", () => {
  const live = parseTitle("Wonderwall (Live with Orchestra)");
  assert.deepEqual(live.variants, ["live"]);
  assert.deepEqual(live.featured, ["orchestra"]);
  assert.deepEqual(parseTitle("Blinding Lights (Remix feat. Rosalía)").variants, ["remix"]);
  assert.notEqual(
    dedupeKey("Wonderwall", ["Oasis"]),
    dedupeKey("Wonderwall (Live with Orchestra)", ["Oasis"]),
    "a live cut with a guest is still a live cut",
  );
});

test("a soundtrack credit is noise, in quotes of either kind", () => {
  const plain = dedupeKey("Let It Go", ["Idina Menzel"]);
  for (const title of [
    'Let It Go (From "Frozen")',
    'Let It Go - From "Frozen"',
    "Let It Go (From “Frozen”)",
  ]) {
    assert.equal(dedupeKey(title, ["Idina Menzel"]), plain, title);
  }
});

test("reissue wording leaves no residue that reads as a variant", () => {
  for (const title of [
    "Wonderwall (Remastered Version)",
    "Wonderwall - Remastered Version",
    "Wonderwall (Deluxe Version)",
    "Wonderwall (30th Anniversary Edition)",
    "Wonderwall (25th Anniversary Remaster)",
  ]) {
    assert.deepEqual(parseTitle(title).variants, [], title);
    assert.equal(parseTitle(title).base, "wonderwall", title);
  }
});

test("a title that is itself a noise word is a title, not decoration", () => {
  assert.equal(parseTitle("Clean").base, "clean");
  assert.equal(parseTitle("Special").base, "special");
  assert.equal(parseTitle("Stereo Hearts").base, "stereo hearts");
  assert.notEqual(dedupeKey("Clean", ["Taylor Swift"]), dedupeKey("Special", ["Taylor Swift"]));
  assert.equal(parseTitle("Bohemian Rhapsody Official Video").base, "bohemian rhapsody");
  assert.equal(parseTitle("Bohemian Rhapsody HD").base, "bohemian rhapsody");
});
