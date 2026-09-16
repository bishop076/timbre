import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { fetchRadios, genreOfStation } from "./radios.ts";

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
});

function answering(body: unknown) {
  globalThis.fetch = (async () => Response.json(body)) as typeof fetch;
}

const POP = {
  id: 132,
  title: "Pop",
  radios: [null, { id: 7, title: "Pop Hits", picture_big: "big.jpg" }, { id: 8 }],
};

// `/explore` is `force-static`, and this read was an `interface` and a cast: one row of `null`
// in `/radio/genres` threw `Cannot read properties of null (reading 'radios')`, and a `data`
// that is not a list threw `(intermediate value) is not iterable` — both before the loop had
// looked at a single station, and both of them the whole page rather than one rail.
test("a genre row Deezer garbled is one rail missing, not a broken Explore", async () => {
  answering({ data: [null, "nope", POP] });
  assert.deepEqual(await fetchRadios(), [
    { id: 7, title: "Pop Hits", genre: "Pop", genreId: 132, imageUrl: "big.jpg" },
  ]);
});

test("a radio-genres body that is not a list is no radios rather than a throw", async () => {
  for (const body of [{ data: { nope: true } }, { data: "not a list" }, {}]) {
    answering(body);
    assert.deepEqual(await fetchRadios(), [], JSON.stringify(body));
    assert.equal(await genreOfStation(7), null, JSON.stringify(body));
  }
});

test("a station still finds the genre it belongs to", async () => {
  answering({ data: [POP] });
  assert.deepEqual(await genreOfStation(7), { id: 132, name: "Pop" });
});
