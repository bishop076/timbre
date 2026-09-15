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

test("an unresolved client_id abstains instead of waiting, and says so instead of finding nothing", async (t) => {
  const fetches = stubSearch(t, { id: 5, title: "Never fetched" });
  const provider = createSoundCloudProvider({ clientId: async () => null });
  // Still no waiting — that is what this test was always for. But `[]` said SoundCloud looked
  // and found nothing, so `searchAll` counted it in `attempted`, left `failures` empty, and the
  // route answered a clean success for a provider that never got as far as asking.
  await assert.rejects(provider.search(ctx, "anything", 5), {
    name: "ProviderError",
    provider: "soundcloud",
    kind: "transient",
    message: "SoundCloud would not hand over a key to search with.",
  });
  assert.equal(fetches.callCount(), 0, "it must still not wait for the crawl");
});

test("a refusal on the search endpoint is an outage, not a page with no results on it", async (t) => {
  for (const status of [401, 403]) {
    t.mock.method(globalThis, "fetch", async () => new Response("", { status }));
    await assert.rejects(proxied().search(ctx, "anything", 5), {
      name: "ProviderError",
      provider: "soundcloud",
      message: `SoundCloud returned ${status}.`,
    });
    t.mock.restoreAll();
  }
});

test("a 404 from oEmbed is still no such track, because that is what it means there", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("", { status: 404 }));
  assert.equal(await proxied().resolve?.(ctx, "https://soundcloud.com/x/y"), null);
});

test("a link on soundcloud.com under another scheme is not resolved", async (t) => {
  const fetches = t.mock.method(globalThis, "fetch", async () => Response.json({ title: "x" })).mock;
  assert.equal(await proxied().resolve?.(ctx, "javascript://soundcloud.com/%0aalert(1)"), null);
  assert.equal(fetches.callCount(), 0);
});

test("with neither a base nor a resolver it is not searchable", () => {
  assert.equal(createSoundCloudProvider().searchable, false);
});
