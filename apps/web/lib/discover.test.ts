import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { fetchDiscover, fetchGenres } from "./discover.ts";

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

// Every list on the chart was an `interface` reached through a cast. `albums.data` as an object
// rather than a list threw `list is not iterable` out of the loop that fills the album rail, and
// one row of `null` in `tracks.data` threw `Cannot read properties of null (reading 'id')` in
// `toTrack` — either of them `/explore` on its error boundary over a chart that arrived whole.
test("a chart Deezer garbled is the rows it did send, not a broken Explore", async () => {
  byPath((path) => {
    if (path === "/genre") return { data: [null, { id: 132, name: "Pop" }, { id: 0 }] };
    if (path.startsWith("/chart/")) {
      return {
        tracks: { data: [null, { id: 5, title: "Idioteque" }] },
        albums: { data: { nope: true } },
        artists: { data: [{ picture_medium: "x" }, { name: "Radiohead" }] },
      };
    }
    return { data: [] };
  });

  const discover = await fetchDiscover(0);
  assert.deepEqual(
    discover.genres.map((genre) => genre.name),
    ["Pop"],
  );
  assert.deepEqual(
    discover.tracks.map((track) => track.title),
    ["Idioteque"],
  );
  assert.deepEqual(discover.albums, []);
  assert.deepEqual(
    discover.artists.map((artist) => artist.name),
    ["Radiohead"],
  );
});

test("a genre list that is not a list is no genres rather than a throw", async () => {
  byPath(() => ({ data: { nope: true } }));
  assert.deepEqual(await fetchGenres(), []);
});
