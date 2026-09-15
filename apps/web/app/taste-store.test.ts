import assert from "node:assert/strict";
import { test } from "node:test";

import { readBook } from "./taste-store.ts";

const known = (at: number) => ({ genreId: 132, releases: [], at });

test("the stored book is held to its size on the way in, not only on the way out", () => {
  const stored: Record<string, unknown> = {};
  for (let index = 0; index < 400; index += 1) stored[`artist-${index}`] = known(index);

  const book = readBook(stored);

  // `remember` caps at 300 on write and the read took whatever it found, so a book left larger
  // by an older build, a second tab or a hand edit came back at its full length and stayed —
  // nothing trims on read, and a write only removes the excess that one write creates.
  assert.equal(Object.keys(book).length, 300);

  // The newest lookups are the ones kept: `at` is when the artist was last asked about.
  assert.ok(book["artist-399"], "the most recent survives");
  assert.equal(book["artist-99"], undefined, "the oldest is dropped");
  assert.ok(book["artist-100"], "the cap falls exactly at 300");
});

test("a book within its size is returned as it was stored", () => {
  const book = readBook({ bicep: known(5), floating: known(9) });
  assert.deepEqual(Object.keys(book).sort(), ["bicep", "floating"]);
});

test("nothing readable stays nothing", () => {
  assert.deepEqual(readBook(null), {});
  assert.deepEqual(readBook([known(1)]), {});
  assert.deepEqual(readBook({ bicep: { at: "yesterday" } }), {});
  assert.deepEqual(readBook({ bicep: { genreId: 1, releases: "lots", at: 1 } }), {});
});

test("a lookup time is the same kind of value the play log calls one", () => {
  // `typeof NaN === "number"`, so this passed. The artist was then never looked up again
  // (`now - NaN > STALE_MS` is false), its whole back catalogue read as new, and `newest()`
  // sorted the book on a comparator returning NaN — which drops whichever entries the engine's
  // sort lands on, real lookups included.
  assert.deepEqual(readBook({ bicep: known(Number.NaN) }), {});
  assert.deepEqual(readBook({ bicep: known(Number.POSITIVE_INFINITY) }), {});
  assert.deepEqual(readBook({ bicep: known(0) }), {});
  assert.deepEqual(readBook({ bicep: known(-1) }), {});

  // 8.64e15 is the last instant a Date can hold; past it `new Date(at)` is an Invalid Date.
  assert.deepEqual(readBook({ bicep: known(8.64e15) }), { bicep: known(8.64e15) });
  assert.deepEqual(readBook({ bicep: known(8.64e15 + 1) }), {});
});

test("a genre id has to be one Deezer could have answered with", () => {
  assert.deepEqual(readBook({ bicep: { genreId: Number.NaN, releases: [], at: 5 } }), {});
  assert.deepEqual(readBook({ bicep: { genreId: 1.5, releases: [], at: 5 } }), {});
  assert.deepEqual(readBook({ bicep: { genreId: 0, releases: [], at: 5 } }), {
    bicep: { genreId: 0, releases: [], at: 5 },
  });
});

test("a book holding more releases than the lookup ever returns is not this app's", () => {
  const release = {
    id: 1,
    title: "Isles",
    artist: "Bicep",
    kind: "album",
    date: "2021-01-22",
    coverUrl: null,
  };
  const many = Array.from({ length: 40 }, (_, index) => ({ ...release, id: index }));

  // `fetchArtistTaste` slices to three, and `useTaste` walks every stored release on render.
  assert.deepEqual(readBook({ bicep: { genreId: 132, releases: many, at: 5 } }), {});
  assert.deepEqual(readBook({ bicep: { genreId: 132, releases: [release], at: 5 } }), {
    bicep: { genreId: 132, releases: [release], at: 5 },
  });
});
