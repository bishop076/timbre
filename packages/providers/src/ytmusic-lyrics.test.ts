import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError, type RateLimiter } from "@timbre/core";

import type { SearchContext } from "./types.ts";
import { createYtMusicLyrics, toYtMusicLyrics } from "./ytmusic-lyrics.ts";

// Every line of text here is an invented placeholder: real lyrics are licensed text.

const CREDIT = "Source: Placeholder Licensing";

const ctx: SearchContext = {
  limiter: { acquire: async () => {} } as unknown as RateLimiter,
};

async function withFetch(
  stub: () => Response,
  body: (calls: { target: string | URL; init?: RequestInit }[]) => Promise<void>,
): Promise<void> {
  const calls: { target: string | URL; init?: RequestInit }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (target: string | URL, init?: RequestInit) => {
    calls.push({ target, init });
    return stub();
  }) as typeof fetch;
  try {
    await body(calls);
  } finally {
    globalThis.fetch = original;
  }
}

test("timed lines arrive in seconds, with the words and the credit alongside", () => {
  const lyrics = toYtMusicLyrics({
    source: "ytmusic",
    synced: true,
    lines: [
      { text: "line one", start_ms: 1200 },
      { text: "", start_ms: 3000 },
      { text: "line two", start_ms: 4500 },
    ],
    attribution: CREDIT,
  });

  assert.deepEqual(lyrics?.synced, [
    { at: 1.2, text: "line one" },
    { at: 3, text: "" },
    { at: 4.5, text: "line two" },
  ]);
  assert.equal(lyrics?.plain, "line one\n\nline two");
  assert.equal(lyrics?.attribution, CREDIT);
});

test("untimed lines become plain text, stanza breaks kept", () => {
  const lyrics = toYtMusicLyrics({
    source: "ytmusic",
    synced: false,
    lines: [
      { text: "la la", start_ms: null },
      { text: "", start_ms: null },
      { text: "la", start_ms: null },
    ],
    attribution: null,
  });

  assert.equal(lyrics?.synced, null);
  assert.equal(lyrics?.plain, "la la\n\nla");
  assert.equal(lyrics?.attribution, null);
});

test("a list claiming timings with a line missing one is shown as plain text", () => {
  const lyrics = toYtMusicLyrics({
    source: "ytmusic",
    synced: true,
    lines: [
      { text: "line one", start_ms: 0 },
      { text: "line two", start_ms: null },
    ],
    attribution: CREDIT,
  });
  assert.equal(lyrics?.synced, null);
});

test("no lines, or only blank ones, is no lyrics", () => {
  const empty = { source: "ytmusic", synced: false, attribution: null };
  assert.equal(toYtMusicLyrics({ ...empty, lines: [] }), null);
  assert.equal(toYtMusicLyrics({ ...empty, lines: [{ text: "  ", start_ms: null }] }), null);
});

test("the lookup posts the song to the sidecar's /lyrics with the shared secret", async () => {
  const lookup = createYtMusicLyrics({ baseUrl: "http://127.0.0.1:8787", sharedSecret: "s3cret" });

  await withFetch(
    () =>
      Response.json({
        source: "ytmusic",
        synced: false,
        lines: [{ text: "la la", start_ms: null }],
        attribution: CREDIT,
      }),
    async (calls) => {
      const lyrics = await lookup(ctx, {
        videoIds: ["aaaaaaaaaaa", "bbbbbbbbbbb"],
        title: "Song Title",
        artist: "Artist",
      });
      assert.equal(lyrics?.plain, "la la");

      assert.equal(String(calls[0]!.target), "http://127.0.0.1:8787/lyrics");
      const init = calls[0]!.init!;
      assert.equal(init.method, "POST");
      assert.equal((init.headers as Record<string, string>)["x-timbre-secret"], "s3cret");
      assert.deepEqual(JSON.parse(String(init.body)), {
        video_ids: ["aaaaaaaaaaa", "bbbbbbbbbbb"],
        title: "Song Title",
        artist: "Artist",
      });
    },
  );
});

test("a sidecar 502 surfaces as a transient provider failure, not as no lyrics", async () => {
  const lookup = createYtMusicLyrics({ baseUrl: "http://127.0.0.1:8787", sharedSecret: "s3cret" });

  await withFetch(
    () => Response.json({ detail: "YouTube Music lyrics failed." }, { status: 502 }),
    async () => {
      await assert.rejects(
        () => lookup(ctx, { videoIds: [], title: "Song Title", artist: "Artist" }),
        (error: unknown) => error instanceof ProviderError && error.kind === "transient",
      );
    },
  );
});
