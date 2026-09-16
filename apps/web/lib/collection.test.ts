import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { fetchCollection, pickMoodPlaylist } from "./collection.ts";
import { DeezerUnavailable } from "./deezer.ts";

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

// The last of S-10's swallowed failures. `/collection/spotify-album/[id]` is `force-static` with
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

/**
 * Everything answers, except the paths named — those come back 503, which is how Deezer looks
 * when it is having a bad minute. `deezerOrFail` turns that into `DeezerUnavailable`; what
 * these tests ask is what the page does with it. Routes are matched in the order written, so
 * the specific ones go above the prefixes they share.
 */
function servingExcept(routes: [string, unknown][], refusing: string[]) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const path = `${url.pathname}${url.search}`;
    if (refusing.some((prefix) => path.startsWith(prefix))) {
      return new Response("upstream is busy", { status: 503 });
    }
    const found = routes.find(([route]) => path.startsWith(route));
    assert.ok(found, `unexpected request to ${path}`);
    return new Response(JSON.stringify(found[1]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

const POP: [string, unknown][] = [
  ["/genre/132/radios", { data: [] }],
  ["/genre", { data: [{ id: 132, name: "Pop" }] }],
  ["/chart/132", { tracks: { data: [] } }],
  ["/editorial/132/selection", { data: [] }],
];

test("a genre Deezer would not list is not a genre that does not exist", async () => {
  // The page turns `null` into notFound() — "That collection has gone … taken down where it
  // lived" — and `force-static` then serves that from the cache for fifteen minutes. Deezer's
  // genre list is a fixed catalogue, so an empty one is a refusal and never an answer, exactly
  // as `/api/genre-feed` already had it. The throw reaches error.tsx, which offers a retry.
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path === "/genre") return new Response("upstream is busy", { status: 503 });
    return new Response(JSON.stringify({ data: [], tracks: { data: [] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  await assert.rejects(() => fetchCollection("genre", "132"), DeezerUnavailable);
});

test("a genre that really is not in the catalogue is still not found", async () => {
  servingExcept(
    [
      ["/genre/999/radios", { data: [] }],
      ["/genre", { data: [{ id: 132, name: "Pop" }] }],
      ["/chart/999", { tracks: { data: [] } }],
      ["/editorial/999/selection", { data: [] }],
    ],
    [],
  );

  assert.equal(await fetchCollection("genre", "999"), null);
});

test("a genre whose every feed was refused says so rather than emptying the page", async () => {
  servingExcept(POP, ["/chart/132", "/editorial/132/selection", "/genre/132/radios"]);

  await assert.rejects(() => fetchCollection("genre", "132"), DeezerUnavailable);
});

test("a mood whose search was refused is not a mood nobody has a playlist for", async () => {
  servingExcept([], ["/search/playlist"]);

  await assert.rejects(() => fetchCollection("mood", "sleep"), DeezerUnavailable);
});

test("a station that answered but would not say what is on it is not a station that has gone", async () => {
  servingExcept(
    [
      ["/radio/genres", { data: [] }],
      ["/radio/37151", { title: "Pop Hits" }],
    ],
    ["/radio/37151/tracks"],
  );

  await assert.rejects(() => fetchCollection("radio", "37151"), DeezerUnavailable);
});
