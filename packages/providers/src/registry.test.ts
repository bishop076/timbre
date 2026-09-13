import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryBucketStore, RateLimiter } from "@timbre/core";

import { createAppleProvider } from "./apple.ts";
import { interleaveByPlayability, recommendFrom, registerProvider, searchAll } from "./registry.ts";
import type { Playback, SourceId } from "./types.ts";

function answer(id: SourceId, playback: Playback, count: number) {
  return {
    provider: { id, playback, searchable: true, search: async () => [] },
    tracks: Array.from({ length: count }, (_, index) => ({
      source: id,
      sourceId: `${id}-${index + 1}`,
      title: `${id} ${index + 1}`,
      artists: [],
      album: null,
      durationMs: null,
      isrc: null,
      url: null,
      artworkUrl: null,
      playback: "queue" as const,
    })),
  };
}

const cases: [string, ReturnType<typeof answer>[], string[]][] = [
  [
    "sources take turns, each keeping its own relevance order",
    [answer("ytmusic", "queue", 3), answer("audius", "queue", 3)],
    ["ytmusic-1", "audius-1", "ytmusic-2", "audius-2", "ytmusic-3", "audius-3"],
  ],
  [
    "the whole playable tier comes first, whatever order the providers registered in",
    [answer("deezer", "link", 2), answer("ytmusic", "queue", 2)],
    ["ytmusic-1", "ytmusic-2", "deezer-1", "deezer-2"],
  ],
  [
    "a short list does not leave gaps in a longer one",
    [answer("ytmusic", "queue", 3), answer("audius", "queue", 1)],
    ["ytmusic-1", "audius-1", "ytmusic-2", "ytmusic-3"],
  ],
  [
    "a source that answered with nothing contributes nothing",
    [answer("ytmusic", "queue", 2), answer("audius", "queue", 0)],
    ["ytmusic-1", "ytmusic-2"],
  ],
];

for (const [name, results, expected] of cases) {
  test(name, () => {
    assert.deepEqual(
      interleaveByPlayability(results).map((track) => track.sourceId),
      expected,
    );
  });
}

test("a radio source that fails is reported to the caller's hook, and an abort is not", async () => {
  const failure = new Error("Deezer returned 503.");
  registerProvider({
    ...answer("deezer", "link", 0).provider,
    radio: async () => {
      throw failure;
    },
  });

  const limiter = new RateLimiter(new MemoryBucketStore());
  const reported: { event: string; fields: Record<string, unknown> }[] = [];
  const report = (event: string, fields: Record<string, unknown>) => reported.push({ event, fields });

  const songs = await recommendFrom({ limiter, report }, { artist: "Fred again.." }, 5);
  assert.deepEqual(songs, [], "a failed source contributes nothing and throws nothing");
  assert.deepEqual(reported, [{ event: "radio_failed", fields: { source: "deezer", error: failure } }]);

  const controller = new AbortController();
  controller.abort();
  reported.length = 0;
  await recommendFrom({ limiter, report, signal: controller.signal }, { artist: "Fred again.." }, 5);
  assert.deepEqual(reported, []);
});

test("a burst that saturates one source fails that source alone, and the next search still returns on time", async () => {
  registerProvider(createAppleProvider());
  const original = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ results: [] })) as typeof fetch;
  const controller = new AbortController();
  const ctx = { limiter: new RateLimiter(new MemoryBucketStore()), signal: controller.signal };
  try {
    const burst = Array.from({ length: 12 }, (_, index) => searchAll(ctx, `q${index}`, 5));
    const started = performance.now();
    const next = await searchAll(ctx, "a real reader", 5);
    assert.ok(performance.now() - started < 1_000, "the next search waited out the queue");
    assert.deepEqual(next.failures, [
      { source: "apple", message: "Apple Music has no free request slot within 3s." },
    ]);
    controller.abort();
    await Promise.all(burst);
  } finally {
    globalThis.fetch = original;
  }
});
