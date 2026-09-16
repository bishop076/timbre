import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { fetchGenreShelf } from "./genre-shelf.ts";

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
});

function answering(status: number, body: unknown) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

const SONG = {
  id: "deezer:1",
  title: "Weightless",
  artists: ["Marconi Union"],
  album: null,
  durationMs: null,
  isrc: null,
  artworkUrl: null,
  sources: [],
};

test("a genre Deezer would not answer for is not a genre with nothing in it", () => {
  // The exact body `/api/genre-feed` sends when its probe tripped: 503, no-store, and a
  // sentence saying so. The shelf used to reduce this to `[]` and then remove itself, which
  // is the page telling the reader there is nothing here on the strength of a refusal.
  answering(503, { error: "Deezer wouldn't answer for this genre just now.", degraded: true });

  return fetchGenreShelf(132, new AbortController().signal).then((found) => {
    assert.equal(found, null);
  });
});

test("a genre that really is empty still answers", async () => {
  answering(200, { genre: { id: 132, name: "Pop" }, stations: [], songs: [], degraded: false });

  assert.deepEqual(await fetchGenreShelf(132, new AbortController().signal), []);
});

test("songs come back as songs", async () => {
  answering(200, { genre: { id: 132, name: "Pop" }, stations: [], songs: [SONG] });

  const found = await fetchGenreShelf(132, new AbortController().signal);
  assert.deepEqual(found?.map((song) => song.id), ["deezer:1"]);
});

test("a body with no songs key is empty, not a crash", async () => {
  answering(200, {});
  assert.deepEqual(await fetchGenreShelf(132, new AbortController().signal), []);

  answering(200, null);
  assert.deepEqual(await fetchGenreShelf(132, new AbortController().signal), []);
});
