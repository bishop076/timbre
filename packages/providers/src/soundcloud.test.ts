import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryBucketStore, RateLimiter } from "@timbre/core";

import { createSoundCloudProvider } from "./soundcloud.ts";

const ctx = { limiter: new RateLimiter(new MemoryBucketStore()) };

function collection(...tracks: Record<string, unknown>[]) {
  return { collection: tracks };
}

function stubFetch(body: unknown) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

test("a rights-gated SNIP is dropped rather than listed as the song", async () => {
  const stub = stubFetch(
    collection(
      { id: 1, title: "Shape of You", duration: 30_000, full_duration: 233_744, policy: "SNIP" },
      { id: 2, title: "Shape of You (Remix)", duration: 208_546, policy: "ALLOW" },
    ),
  );
  try {
    const provider = createSoundCloudProvider({ apiBase: "https://example.test/_/api/v2" });
    const tracks = await provider.search!(ctx, "shape of you", 10);
    assert.deepEqual(
      tracks.map((track) => track.title),
      ["Shape of You (Remix)"],
    );
  } finally {
    stub.restore();
  }
});

test("a track with no policy at all is kept", async () => {
  const stub = stubFetch(collection({ id: 3, title: "Untitled Demo", duration: 91_000 }));
  try {
    const provider = createSoundCloudProvider({ apiBase: "https://example.test/_/api/v2" });
    const tracks = await provider.search!(ctx, "demo", 10);
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0]!.durationMs, 91_000);
  } finally {
    stub.restore();
  }
});

test("the direct path asks api-v2 itself, with the resolved client_id", async () => {
  const stub = stubFetch(collection({ id: 4, title: "Something", duration: 60_000, policy: "ALLOW" }));
  try {
    const provider = createSoundCloudProvider({ clientId: async () => "RESOLVED_ID_0123456789" });
    assert.equal(provider.searchable, true);
    await provider.search!(ctx, "something", 5);
    assert.match(stub.calls[0]!, /^https:\/\/api-v2\.soundcloud\.com\/search\/tracks\?/);
    assert.match(stub.calls[0]!, /client_id=RESOLVED_ID_0123456789/);
  } finally {
    stub.restore();
  }
});

test("an unresolved client_id abstains instead of waiting", async () => {
  const stub = stubFetch(collection({ id: 5, title: "Never fetched" }));
  try {
    const provider = createSoundCloudProvider({ clientId: async () => null });
    assert.deepEqual(await provider.search!(ctx, "anything", 5), []);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test("with neither a base nor a resolver it is not searchable", () => {
  assert.equal(createSoundCloudProvider().searchable, false);
});
