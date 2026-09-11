import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { MemoryBucketStore, RateLimiter } from "@timbre/core";

import { createSoundCloudProvider } from "./soundcloud.ts";

const ctx = { limiter: new RateLimiter(new MemoryBucketStore()) };
const proxied = () => createSoundCloudProvider({ apiBase: "https://example.test/_/api/v2" });

function stubSearch(t: TestContext, ...tracks: Record<string, unknown>[]) {
  return t.mock.method(globalThis, "fetch", async () => Response.json({ collection: tracks })).mock;
}

test("a rights-gated SNIP is dropped rather than listed as the song", async (t) => {
  stubSearch(
    t,
    { id: 1, title: "Shape of You", duration: 30_000, full_duration: 233_744, policy: "SNIP" },
    { id: 2, title: "Shape of You (Remix)", duration: 208_546, policy: "ALLOW" },
  );
  const tracks = await proxied().search(ctx, "shape of you", 10);
  assert.deepEqual(
    tracks.map((track) => track.title),
    ["Shape of You (Remix)"],
  );
});

test("a snipped transcoding is a clip too, whatever the policy says", async (t) => {
  const transcodings = (...snipped: boolean[]) => ({ transcodings: snipped.map((value) => ({ snipped: value })) });
  stubSearch(
    t,
    { id: 6, title: "Shape of You", duration: 30_000, policy: "MONETIZE", media: transcodings(false, true) },
    { id: 7, title: "Perfect", duration: 263_400, policy: "MONETIZE", media: transcodings(false, false) },
  );
  const tracks = await proxied().search(ctx, "ed sheeran", 10);
  assert.deepEqual(
    tracks.map((track) => track.title),
    ["Perfect"],
  );
});

test("a track with no policy at all is kept", async (t) => {
  stubSearch(t, { id: 3, title: "Untitled Demo", duration: 91_000 });
  const tracks = await proxied().search(ctx, "demo", 10);
  assert.deepEqual(
    tracks.map((track) => track.durationMs),
    [91_000],
  );
});

test("the direct path asks api-v2 itself, with the resolved client_id", async (t) => {
  const fetches = stubSearch(t, { id: 4, title: "Something", duration: 60_000, policy: "ALLOW" });
  const provider = createSoundCloudProvider({ clientId: async () => "RESOLVED_ID_0123456789" });
  assert.equal(provider.searchable, true);
  await provider.search(ctx, "something", 5);
  const url = String(fetches.calls[0]!.arguments[0]);
  assert.match(url, /^https:\/\/api-v2\.soundcloud\.com\/search\/tracks\?/);
  assert.match(url, /client_id=RESOLVED_ID_0123456789/);
});

test("an unresolved client_id abstains instead of waiting", async (t) => {
  const fetches = stubSearch(t, { id: 5, title: "Never fetched" });
  const provider = createSoundCloudProvider({ clientId: async () => null });
  assert.deepEqual(await provider.search(ctx, "anything", 5), []);
  assert.equal(fetches.callCount(), 0);
});

test("with neither a base nor a resolver it is not searchable", () => {
  assert.equal(createSoundCloudProvider().searchable, false);
});
