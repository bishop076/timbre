import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryBucketStore, ProviderError, RateLimiter } from "@timbre/core";

import { createYtMusicProvider, isYtMusicPlaylistId, isYtMusicProvider } from "./ytmusic.ts";

const ctx = { limiter: new RateLimiter(new MemoryBucketStore()) };
const provider = createYtMusicProvider({ baseUrl: "http://127.0.0.1:8787", sharedSecret: "s3cret" });

const PLAYLIST = {
  id: "PL11WrGDTdUZL4uIIT7DsKk7cfzPiIsqat",
  title: "Lofi Hip Hop 2026",
  author: "Hitet Shqip",
  year: "2026",
  track_count: 60,
  thumbnail_url: "https://yt3.googleusercontent.com/p=s1200",
  tracks: [
    {
      video_id: "uk_E_RieeWA",
      title: "ceiling duty",
      artists: ["lilibu"],
      album: "ceiling duty",
      duration_seconds: 143,
      thumbnail_url: "https://lh3.googleusercontent.com/a=w120-h120",
      is_explicit: false,
      result_type: "song",
      video_type: "MUSIC_VIDEO_TYPE_ATV",
    },
  ],
};

async function withSidecar(
  status: number,
  body: unknown,
  run: (calls: { url: string; init?: RequestInit }[]) => Promise<void>,
): Promise<void> {
  const calls: { url: string; init?: RequestInit }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Response.json(body, { status });
  }) as typeof fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

test("a playlist is asked for by id, limit and secret, and its songs are search-shaped tracks", async () => {
  await withSidecar(200, PLAYLIST, async (calls) => {
    const found = await provider.playlist(ctx, PLAYLIST.id, 100);
    assert.ok(found);
    assert.equal(found.title, "Lofi Hip Hop 2026");
    assert.equal(found.author, "Hitet Shqip");
    assert.equal(found.trackCount, 60);
    assert.equal(found.artworkUrl, PLAYLIST.thumbnail_url);
    assert.deepEqual(found.tracks, [
      {
        source: "ytmusic",
        sourceId: "uk_E_RieeWA",
        title: "ceiling duty",
        artists: ["lilibu"],
        album: "ceiling duty",
        durationMs: 143_000,
        isrc: null,
        url: "https://music.youtube.com/watch?v=uk_E_RieeWA",
        artworkUrl: "https://lh3.googleusercontent.com/a=w120-h120",
        playback: "queue",
        videoType: "MUSIC_VIDEO_TYPE_ATV",
      },
    ]);

    assert.equal(calls.length, 1);
    const { url, init } = calls[0]!;
    assert.equal(url, "http://127.0.0.1:8787/playlist");
    assert.equal(init?.method, "POST");
    assert.equal((init?.headers as Record<string, string>)["x-timbre-secret"], "s3cret");
    assert.deepEqual(JSON.parse(String(init?.body)), { playlist_id: PLAYLIST.id, limit: 100 });
  });
});

test("a playlist that is not public is null, not an error", async () => {
  await withSidecar(404, { detail: "No public playlist with that id." }, async () => {
    assert.equal(await provider.playlist(ctx, PLAYLIST.id, 100), null);
  });
});

test("an upstream failure still throws, so it is not mistaken for a missing playlist", async () => {
  await withSidecar(502, { detail: "YouTube Music playlist failed." }, async () => {
    await assert.rejects(
      provider.playlist(ctx, PLAYLIST.id, 100),
      (error: unknown) => error instanceof ProviderError && error.kind === "transient",
    );
  });
});

test("an id that cannot be a playlist is refused without asking the sidecar", async () => {
  await withSidecar(200, PLAYLIST, async (calls) => {
    assert.equal(await provider.playlist(ctx, "RDAMVMfa5IWHDbftI", 100), null);
    assert.equal(await provider.playlist(ctx, "../../search", 100), null);
    assert.equal(calls.length, 0);
  });
});

test("playlist ids: albums and editorial lists pass, mixes and personal lists do not", () => {
  for (const id of [
    "PL11WrGDTdUZL4uIIT7DsKk7cfzPiIsqat",
    "OLAK5uy_mz6eafmqdRHSaR4IwG0ll6J6rgv0_ZpGw",
    "RDCLAK5uy_kb7EBi6y3GrtJri4_ZH56Ms786DFEimbM",
  ]) {
    assert.ok(isYtMusicPlaylistId(id), id);
  }
  for (const id of ["RDAMVMfa5IWHDbftI", "RDEMabcdefghijklmn", "LL", "WL", "LM", "", "PL/../x1234567"]) {
    assert.ok(!isYtMusicPlaylistId(id), id);
  }
});

test("the provider is recognisable in the registry", () => {
  assert.ok(isYtMusicProvider(provider));
});
