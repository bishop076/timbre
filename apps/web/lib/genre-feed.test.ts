import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { drawStations, fetchFresh } from "./genre-feed.ts";

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
});

function byPath(reply: (path: string) => unknown) {
  globalThis.fetch = ((input: string | URL | Request) =>
    Promise.resolve(
      Response.json(reply(new URL(String(input instanceof Request ? input.url : input)).pathname)),
    )) as typeof fetch;
}
// `drawStations` reads `raw.title.trim()` on every station Deezer lists for a genre, through an
// `interface` and a cast. One station row with no `title` threw
// `Cannot read properties of undefined (reading 'trim')` — `/api/genre-feed` answering 500 and
// `/collection/genre/<id>` on its error boundary, over a genre that was otherwise fine.
test("a station row with no title is one station fewer, not a broken genre", async () => {
  byPath((path) => {
    if (path.endsWith("/radios")) return { data: [{ id: 1 }, { id: 2, title: " Pop Hits " }] };
    if (path.includes("/radio/")) return { data: [{ id: 9, title: "Song" }] };
    return { data: [] };
  });

  const { stations } = await drawStations(132);
  assert.deepEqual(
    stations.map((station) => station.title),
    ["Pop Hits"],
  );
});

test("a radios body that is not a list draws no stations rather than throwing", async () => {
  byPath((path) => (path.endsWith("/radios") ? { data: { nope: true } } : { data: [] }));
  assert.deepEqual(await drawStations(132), { stations: [], tracks: [] });
});

test("an album in the fresh selection that is not an album is left out of it", async () => {
  byPath((path) => {
    if (path.includes("/editorial/")) return { data: [{ id: 1 }, { id: 2 }] };
    if (path.endsWith("/album/1")) {
      return { id: 1, title: "Fresh", tracks: { data: [null, { id: 5, title: "Song" }] } };
    }
    return { nope: true };
  });

  assert.deepEqual(
    (await fetchFresh(0)).map((track) => track.title),
    ["Song"],
  );
});
