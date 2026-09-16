import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryBucketStore, RateLimiter } from "@timbre/core";

import { createAppleProvider } from "./apple.ts";
import { createDeezerProvider } from "./deezer.ts";
import { previewOn } from "./preview-url.ts";
import type { SearchContext } from "./types.ts";

const ctx: SearchContext = { limiter: new RateLimiter(new MemoryBucketStore()) };

const HOSTILE = "https://evil.example/x.mp3";

async function withBody(body: unknown, run: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => Response.json(body)) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

const cases: [string, string, string | null][] = [
  ["deezer", "https://cdnt-preview.dzcdn.net/api/1/1/a.mp3", "https://cdnt-preview.dzcdn.net/api/1/1/a.mp3"],
  ["apple", "https://audio-ssl.itunes.apple.com/preview/a.m4a", "https://audio-ssl.itunes.apple.com/preview/a.m4a"],
  ["apple", "https://aod-ssl.mzstatic.com/preview/a.m4a", "https://aod-ssl.mzstatic.com/preview/a.m4a"],
  ["spotify", "https://p.scdn.co/mp3-preview/abc", "https://p.scdn.co/mp3-preview/abc"],
  ["deezer", HOSTILE, null],
  ["apple", HOSTILE, null],
  ["spotify", HOSTILE, null],
  // A vendor is not a free pass for its neighbours: nothing legitimate crosses.
  ["deezer", "https://p.scdn.co/mp3-preview/abc", null],
  ["apple", "https://cdnt-preview.dzcdn.net/api/1/1/a.mp3", null],
  // The lookalike a bare `endsWith` on the bare domain would let through.
  ["deezer", "https://evil-dzcdn.net/x.mp3", null],
  // Not https, not a URL, and a scheme an `<audio src>` would simply try to load.
  ["deezer", "http://cdnt-preview.dzcdn.net/api/1/1/a.mp3", null],
  ["deezer", "data:audio/mpeg;base64,AAAA", null],
  ["deezer", "not a url at all", null],
  ["ytmusic", "https://cdnt-preview.dzcdn.net/api/1/1/a.mp3", null],
];

for (const [source, raw, expected] of cases) {
  test(`${source} preview: ${raw.slice(0, 48)}`, () => {
    assert.equal(previewOn(source as never, raw), expected);
  });
}

test("a preview named on someone else's host never leaves the Deezer provider", () =>
  withBody(
    {
      data: [
        { id: 1, title: "Kept", duration: 1, preview: "https://cdnt-preview.dzcdn.net/api/1/1/ok.mp3" },
        { id: 2, title: "Dropped", duration: 1, preview: HOSTILE },
      ],
    },
    async () => {
      const [kept, dropped] = await createDeezerProvider().search(ctx, "x", 2);
      assert.equal(kept?.previewUrl, "https://cdnt-preview.dzcdn.net/api/1/1/ok.mp3");
      // The clip is what `<audio src>` is set to, so an unlisted host here is the listener's
      // browser connecting to it. `song-shape.ts` refuses the same URL on the storage path;
      // a live search result is never read through `usableSong`, so it has to be safe already.
      assert.equal(dropped?.previewUrl, null, "a live search result is played exactly as it arrives");
      assert.equal(dropped?.title, "Dropped", "the track itself is still a result");
    },
  ));

test("the same holds for Apple, whose previews are the other host in the pair", () =>
  withBody(
    {
      results: [
        { trackId: 1, trackName: "Kept", previewUrl: "https://audio-ssl.itunes.apple.com/p/ok.m4a" },
        { trackId: 2, trackName: "Dropped", previewUrl: HOSTILE },
      ],
    },
    async () => {
      const [kept, dropped] = await createAppleProvider().search(ctx, "x", 2);
      assert.equal(kept?.previewUrl, "https://audio-ssl.itunes.apple.com/p/ok.m4a");
      assert.equal(dropped?.previewUrl, null);
    },
  ));
