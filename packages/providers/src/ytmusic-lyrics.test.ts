import assert from "node:assert/strict";
import { test } from "node:test";

import { ProviderError, type RateLimiter } from "@timbre/core";

import { createYtMusicLyrics, toYtMusicLyrics } from "./ytmusic-lyrics.ts";

const CREDIT = "Source: Placeholder Licensing";
const ctx = { limiter: { acquire: async () => {} } as unknown as RateLimiter };
const lookup = createYtMusicLyrics({ baseUrl: "http://127.0.0.1:8787", sharedSecret: "s3cret" });
const line = (text: string, start_ms: number | null) => ({ text, start_ms });

async function withFetch(
  answer: Response,
  body: (calls: { target: string | URL; init?: RequestInit }[]) => Promise<void>,
): Promise<void> {
  const calls: { target: string | URL; init?: RequestInit }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (target: string | URL, init?: RequestInit) => {
    calls.push({ target, init });
    return answer;
  }) as typeof fetch;
  try {
    await body(calls);
  } finally {
    globalThis.fetch = original;
  }
}

test("timed lines arrive in seconds, with the words and the credit alongside", () => {
  const lines = [line("line one", 1200), line("", 3000), line("line two", 4500)];
  assert.deepEqual(toYtMusicLyrics({ synced: true, lines, attribution: CREDIT }), {
    synced: [
      { at: 1.2, text: "line one" },
      { at: 3, text: "" },
      { at: 4.5, text: "line two" },
    ],
    plain: "line one\n\nline two",
    attribution: CREDIT,
  });
});

test("untimed lines, or a timed list with a line missing its time, become plain text", () => {
  const untimed = [line("la la", null), line("", null), line("la", null)];
  assert.deepEqual(toYtMusicLyrics({ synced: false, lines: untimed, attribution: null }), {
    synced: null,
    plain: "la la\n\nla",
    attribution: null,
  });
  const partly = [line("line one", 0), line("line two", null)];
  assert.equal(toYtMusicLyrics({ synced: true, lines: partly, attribution: CREDIT })?.synced, null);
});

test("no lines, or only blank ones, is no lyrics", () => {
  assert.equal(toYtMusicLyrics({ synced: false, lines: [], attribution: null }), null);
  assert.equal(toYtMusicLyrics({ synced: false, lines: [line("  ", null)], attribution: null }), null);
});

test("the lookup posts the song to the sidecar's /lyrics with the shared secret", async () => {
  const answer = Response.json({ source: "ytmusic", synced: false, lines: [line("la la", null)], attribution: CREDIT });
  await withFetch(answer, async (calls) => {
    const song = { videoIds: ["aaaaaaaaaaa", "bbbbbbbbbbb"], title: "Song Title", artist: "Artist" };
    assert.equal((await lookup(ctx, song))?.plain, "la la");

    const { target, init } = calls[0]!;
    assert.equal(String(target), "http://127.0.0.1:8787/lyrics");
    assert.equal(init?.method, "POST");
    assert.equal((init?.headers as Record<string, string>)["x-timbre-secret"], "s3cret");
    assert.deepEqual(JSON.parse(String(init?.body)), { video_ids: song.videoIds, title: "Song Title", artist: "Artist" });
  });
});

test("a sidecar 502 surfaces as a transient provider failure, not as no lyrics", async () => {
  await withFetch(Response.json({ detail: "YouTube Music lyrics failed." }, { status: 502 }), async () => {
    await assert.rejects(
      lookup(ctx, { videoIds: [], title: "Song Title", artist: "Artist" }),
      (error: unknown) => error instanceof ProviderError && error.kind === "transient",
    );
  });
});
