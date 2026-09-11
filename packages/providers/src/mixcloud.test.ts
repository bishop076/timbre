import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryBucketStore, RateLimiter } from "@timbre/core";

import { createMixcloudProvider } from "./mixcloud.ts";

const ctx = { limiter: new RateLimiter(new MemoryBucketStore()) };

test("a cloudcast links to mixcloud.com, and a key that would leave it gets no link", async (t) => {
  const keys = ["/someone/late-night-mix/", "@evil.example/x/", "//evil.example/x/", "https://evil.example/x/"];
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ data: keys.map((key) => ({ key, name: "Late Night Mix" })) }),
  );
  const tracks = await createMixcloudProvider().search!(ctx, "late night", 10);
  assert.deepEqual(
    tracks.map((track) => track.url),
    ["https://www.mixcloud.com/someone/late-night-mix/", "https://www.mixcloud.com/@evil.example/x/", null, null],
  );
});
