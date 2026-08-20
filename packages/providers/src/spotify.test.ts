import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryBucketStore, RateLimiter } from "@timbre/core";

import { findSpotifyTrackId } from "./spotify.ts";

const ctx = { limiter: new RateLimiter(new MemoryBucketStore()) };

/** Serves canned JSON per URL substring, and records what was asked for. */
function stubFetch(routes: { match: string; body: unknown }[]) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const hit = routes.find((route) => url.includes(route.match));
    if (!hit) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(hit.body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

const relation = (id: string) => ({
  recordings: [
    { id: "mbid-1", relations: [{ url: { resource: `https://open.spotify.com/track/${id}` } }] },
  ],
});

test("the id rides along with the ISRC lookup, costing no second request", async () => {
  // `inc=url-rels` is the whole point: MusicBrainz records where a recording streams, and
  // asking costs nothing beyond the lookup already being made for the MBID.
  const stub = stubFetch([{ match: "/isrc/", body: relation("2olIQt0rL0hOHau1SJ4xf2") }]);
  try {
    const found = await findSpotifyTrackId(ctx, { title: "Get Lucky", isrc: "USQX91300108" });
    assert.equal(found, "2olIQt0rL0hOHau1SJ4xf2");
    assert.equal(stub.calls.length, 1);
    assert.match(stub.calls[0]!, /inc=url-rels/);
  } finally {
    stub.restore();
  }
});

test("the dataset is still asked when nobody has linked the recording", async () => {
  // The two are complementary rather than ranked — the relation exists when an editor added
  // it, the dataset when MetaBrainz's mapping found it — so a miss on one tries the other.
  const stub = stubFetch([
    { match: "/isrc/", body: { recordings: [{ id: "mbid-2", relations: [] }] } },
    { match: "spotify-id-from-mbid", body: [{ spotify_track_ids: ["FROM_DATASET_000000000"] }] },
  ]);
  try {
    const found = await findSpotifyTrackId(ctx, { title: "Obscure", isrc: "GBAAA0000001" });
    assert.equal(found, "FROM_DATASET_000000000");
    assert.equal(stub.calls.length, 2);
  } finally {
    stub.restore();
  }
});

test("an ISRC MusicBrainz does not carry resolves to nothing, not to a guess", async () => {
  const stub = stubFetch([{ match: "/isrc/", body: { recordings: [] } }]);
  try {
    assert.equal(await findSpotifyTrackId(ctx, { title: "Nowhere", isrc: "ZZAAA0000001" }), null);
  } finally {
    stub.restore();
  }
});

test("with neither an album nor an ISRC there is nothing to ask", async () => {
  // Both routes need one or the other, and the endpoint would only say so after a round trip.
  const stub = stubFetch([]);
  try {
    assert.equal(await findSpotifyTrackId(ctx, { title: "Just a title" }), null);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});
