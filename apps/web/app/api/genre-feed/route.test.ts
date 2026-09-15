import assert from "node:assert/strict";
import { test } from "node:test";

import { GET } from "./route.ts";

const GENRES = {
  data: [
    { id: 132, name: "Pop", picture_medium: "https://cdn-images.dzcdn.net/pop.jpg" },
    { id: 116, name: "Rap/Hip Hop" },
  ],
};

/** Deezer answers 200 to everything and puts the verdict in the body; 4 is its quota refusal. */
const QUOTA_REFUSAL = { error: { code: 4, message: "Quota limit exceeded" } };

const ALBUM = {
  id: 9,
  title: "Detour",
  release_date: "2026-09-01",
  tracks: { data: [{ id: 41, title: "Freak It", rank: 900, artist: { name: "Kim Petras" } }] },
};

type Reply = (path: string) => unknown;

async function withDeezer<T>(reply: Reply, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    assert.equal(url.origin, "https://api.deezer.com", "the suite must never leave the machine");
    return Promise.resolve(Response.json(reply(url.pathname + url.search)));
  }) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

const ask = (query: string) => GET(new Request(`http://timbre.test/api/genre-feed?${query}`));

test("a Deezer outage is a 503, not 'No such genre.'", async () => {
  const response = await withDeezer(() => QUOTA_REFUSAL, () => ask("id=132"));

  // `fetchGenres` forgives the refusal into `[]`, and `[]` is not a catalogue in which Pop is
  // absent — it is a read that never happened.
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("a genre id nobody has is still an honest 404", async () => {
  const response = await withDeezer(
    (path) => (path === "/genre" ? GENRES : { data: [] }),
    () => ask("id=99999"),
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "No such genre." });
});

test("a feed that is empty because Deezer refused is never cached", async () => {
  const response = await withDeezer(
    (path) => (path === "/genre" ? GENRES : QUOTA_REFUSAL),
    () => ask("id=132"),
  );

  // Fifteen minutes of `s-maxage` with an hour of stale-while-revalidate behind it is how one
  // quota blip became an hour of "nothing fresh in Pop".
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("a feed thinned by a refusal is served but not remembered", async () => {
  const response = await withDeezer(
    (path) => {
      if (path === "/genre") return GENRES;
      if (path.startsWith("/editorial/")) return { data: [{ id: 9, genre_id: 132 }] };
      if (path.startsWith("/album/")) return ALBUM;
      return QUOTA_REFUSAL; // the radio draw is the half that failed
    },
    () => ask("id=132"),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = (await response.json()) as { songs: unknown[]; degraded: boolean };
  assert.equal(body.songs.length, 1, "the caller still gets the best that could be had");
  assert.equal(body.degraded, true);
});

test("a whole feed is cached as before", async () => {
  const response = await withDeezer(
    (path) => {
      if (path === "/genre") return GENRES;
      if (path.startsWith("/editorial/")) return { data: [{ id: 9, genre_id: 132 }] };
      if (path.startsWith("/album/")) return ALBUM;
      if (path.endsWith("/radios")) return { data: [{ id: 5, title: "Pop Hits" }] };
      return { data: [{ id: 77, title: "Another", artist: { name: "Someone" } }] };
    },
    () => ask("id=132"),
  );

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("cache-control"),
    "public, s-maxage=900, stale-while-revalidate=3600",
  );
  const body = (await response.json()) as { songs: unknown[]; degraded: boolean; stations: unknown[] };
  assert.equal(body.degraded, false);
  assert.equal(body.songs.length, 2);
  assert.equal(body.stations.length, 1);
});
