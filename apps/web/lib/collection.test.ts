import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { fetchCollection, pickMoodPlaylist } from "./collection.ts";

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
});

/** Answers only the paths given, and fails the test on any other call — nothing reaches the network. */
function serving(routes: Record<string, unknown>) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const key = Object.keys(routes).find((path) => `${url.pathname}${url.search}`.startsWith(path));
    assert.ok(key, `unexpected request to ${url.pathname}${url.search}`);
    return new Response(JSON.stringify(routes[key]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

// The shape and the values are what api.deezer.com/search/playlist?q=sleep returns, trimmed to
// the fields this code reads. Deezer's own order is relevance; `nb_tracks` is unrelated to it.
const SLEEP = [
  { id: 1, nb_tracks: 50 }, // "Sleep Sequence", Deezer's editorial pick and its top hit
  { id: 2, nb_tracks: 40 }, // "Cosmic Sleep"
  { id: 3, nb_tracks: 473 }, // "Berceuses 2.0 Pour Endormir Bébé" — French lullabies for babies
];

test("a mood takes Deezer's best answer, not its longest", () => {
  assert.equal(pickMoodPlaylist(SLEEP)?.id, 1);
  // The same shape as `focus` (Deezer ranks "Focus" at 102 tracks first, "Calm Piano" has 200)
  // and `party` ("Party Hits" at 50 first, "Afro House" has 100).
  assert.equal(pickMoodPlaylist([{ id: 9, nb_tracks: 102 }, { id: 8, nb_tracks: 200 }])?.id, 9);
});

test("length still rules out a stub, and only then picks the longest", () => {
  assert.equal(pickMoodPlaylist([{ id: 4, nb_tracks: 3 }, { id: 5, nb_tracks: 60 }])?.id, 5);
  assert.equal(pickMoodPlaylist([{ id: 4, nb_tracks: 3 }, { id: 5, nb_tracks: 9 }])?.id, 5);
  assert.equal(pickMoodPlaylist([{ id: 6 }, { id: 7, nb_tracks: 2 }])?.id, 7);
});

test("no answer at all is no collection", () => {
  assert.equal(pickMoodPlaylist([]), undefined);
});

test("the mood page opens the playlist that was picked", async () => {
  serving({
    "/search/playlist": { data: SLEEP },
    "/playlist/1": {
      title: "Sleep Sequence",
      nb_tracks: 50,
      creator: { name: "Deezer" },
      tracks: { data: [{ id: 11, title: "Weightless", artist: { name: "Marconi Union" } }] },
    },
  });

  const collection = await fetchCollection("mood", "sleep");
  assert.equal(collection?.title, "Sleep");
  assert.match(collection!.subtitle, /^Sleep Sequence · /);
  assert.deepEqual(collection?.tracks.map((track) => track.title), ["Weightless"]);
});

// The last of the swallowed failures. `/collection/spotify-album/[id]` is `force-static` with
// a fifteen-minute `revalidate` and turns `null` into `notFound()`, so a Spotify outage published
// "no such album" about an album that exists — and kept it. Measured before the fix: a real id
// came back `null` after two failed requests.
test("a Spotify outage is not an album that does not exist", async () => {
  process.env.YTMUSIC_SHARED_SECRET ??= "test-secret";
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;

  await assert.rejects(() => fetchCollection("spotify-album", "4m2880jivSbbyEGAKfITCa"));
});

// And the distinction still works the other way: Spotify answering "there is no such thing" is
// an absence, and `notFound()` is the right page for it.
test("a Spotify id nothing answers to is still an absence", async () => {
  process.env.YTMUSIC_SHARED_SECRET ??= "test-secret";
  globalThis.fetch = (async () =>
    new Response("not found", { status: 404 })) as typeof fetch;

  assert.equal(await fetchCollection("spotify-album", "4m2880jivSbbyEGAKfITCa"), null);
  // An id that is not a Spotify id never leaves the building.
  assert.equal(await fetchCollection("spotify-album", "nope"), null);
});
