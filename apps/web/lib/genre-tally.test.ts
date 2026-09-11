import assert from "node:assert/strict";
import { test } from "node:test";

import { artistKey, dominantGenre, listNames, tallyGenres } from "./genre-tally.ts";

const ROCK = 152;
const ALTERNATIVE = 85;
const POP = 132;

test("an artist is filed under whatever most of their releases are tagged", () => {
  assert.equal(dominantGenre([85, 152, 85, 85, 85, 85, 85, 85, 85, 85]), ALTERNATIVE);
});

test("untagged releases and Deezer's catch-all do not vote", () => {
  assert.equal(dominantGenre([0, -1, 0, ROCK]), ROCK);
  assert.equal(dominantGenre([0, -1, null, undefined]), null);
  assert.equal(dominantGenre([]), null);
});

test("a tie goes to the genre seen first — the newest release, as callers order them", () => {
  assert.equal(dominantGenre([POP, ROCK, ROCK, POP]), POP);
});

test("recent plays outweigh older ones", () => {
  const genres = { a: ROCK, b: POP } as Record<string, number>;
  const tally = tallyGenres(
    [{ artist: "a" }, { artist: "b" }, { artist: "b" }],
    (artist) => genres[artist] ?? null,
  );
  assert.deepEqual(
    tally.map((genre) => genre.id),
    [POP, ROCK],
  );

  const older = tallyGenres(
    [{ artist: "a" }, ...Array(20).fill({ artist: "x" }), { artist: "b" }, { artist: "b" }],
    (artist) => genres[artist] ?? null,
  );
  assert.equal(older[0]!.id, ROCK);
});

test("plays of unknown artists, or with no artist, are skipped rather than guessed", () => {
  const tally = tallyGenres([{ artist: undefined }, { artist: "unknown" }, { artist: "a" }], (artist) =>
    artist === "a" ? ROCK : null,
  );
  assert.deepEqual(
    tally.map((genre) => genre.id),
    [ROCK],
  );
});

test("a genre names who put it there, each once, newest first and at most three", () => {
  const [rock] = tallyGenres(
    ["Weezer", "weezer", "Pixies", "Weezer", "Nirvana", "Foo Fighters"].map((artist) => ({ artist })),
    () => ROCK,
  );
  assert.deepEqual(rock!.artists, ["Weezer", "Pixies", "Nirvana"]);
});

test("artist keys fold case and accents, so one artist is one entry", () => {
  assert.equal(artistKey("Beyoncé"), artistKey("beyonce"));
});

test("names join as prose", () => {
  assert.equal(listNames([]), "");
  assert.equal(listNames(["A"]), "A");
  assert.equal(listNames(["A", "B"]), "A and B");
  assert.equal(listNames(["A", "B", "C"]), "A, B and C");
});
