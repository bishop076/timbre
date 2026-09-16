import assert from "node:assert/strict";
import { test } from "node:test";

import { cached } from "@/lib/api";

import { GET } from "./route.ts";

const ask = (query: string) => GET(new Request(`http://timbre.test/api/search?${query}`));

/**
 * Seeds the in-process response cache the route reads through, so a header can be measured
 * without a search actually leaving the machine. The key is the route's own —
 * `search:<limit>:<lowercased query>` — and no `keep` is passed, because the point of the
 * degraded case is to get a body past the rule that would normally refuse to hold it.
 */
function seed(key: string, body: unknown): Promise<unknown> {
  return cached(key, async () => body);
}

// Measured on a production build, read off the network panel: `200 OK` with no `cache-control`
// at all. `200` is a heuristically cacheable status and nothing else in the response bounds it —
// no `etag`, no `last-modified`, no `expires` — so the only thing deciding how long a shared
// cache held a search result was that cache's own default, over a body the app itself calls
// fresh for two minutes.
test("a whole search result says how long it may be shared, and it is the app's own window", async () => {
  await seed("search:20:whole", { songs: [], failures: [], attempted: ["deezer"] });
  const response = await ask("q=whole");

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, s-maxage=120");
});

// `whole` already refuses to keep a degraded answer in process — "a result missing a provider is
// not the answer to this query, only the best that could be had at that moment". A cache in
// front of Timbre has no way to work that out, and used to be told nothing at all.
test("a result a provider is missing from is never remembered by anything", async () => {
  await seed("search:20:degraded", {
    songs: [],
    failures: [{ source: "soundcloud" }],
    attempted: ["deezer", "soundcloud"],
  });
  const response = await ask("q=degraded");

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("a query that is not one is a 400 that says which field, and is not a search", async () => {
  const response = await ask("q=");

  assert.equal(response.status, 400);
  const body = (await response.json()) as { error: string; issues: unknown[] };
  assert.match(body.error, /search query/i);
  assert.ok(body.issues.length > 0);
});
