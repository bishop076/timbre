import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryBucketStore, ProviderError, RateLimiter } from "@timbre/core";

import { createYtMusicProvider, isYtMusicPlaylistId, isYtMusicProvider } from "./ytmusic.ts";

const ctx = { limiter: new RateLimiter(new MemoryBucketStore()) };
const config = { baseUrl: "http://127.0.0.1:8787", sharedSecret: "s3cret" };

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

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function stubFetch(status: number, body: unknown) {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

test("a playlist's songs come back as the same source tracks a search returns", async () => {
  const stub = stubFetch(200, PLAYLIST);
  try {
    const found = await createYtMusicProvider(config).playlist(ctx, PLAYLIST.id, 100);
    assert.ok(found);
    assert.equal(found.title, "Lofi Hip Hop 2026");
    assert.equal(found.author, "Hitet Shqip");
    assert.equal(found.trackCount, 60);
    assert.equal(found.artworkUrl, PLAYLIST.thumbnail_url);
    assert.deepEqual(found.tracks[0], {
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
    });
  } finally {
    stub.restore();
  }
});

test("the request carries the id, the limit and the shared secret", async () => {
  const stub = stubFetch(200, PLAYLIST);
  try {
    await createYtMusicProvider(config).playlist(ctx, PLAYLIST.id, 100);
    assert.equal(stub.calls.length, 1);
    const [call] = stub.calls;
    assert.equal(call!.url, "http://127.0.0.1:8787/playlist");
    assert.equal(call!.init?.method, "POST");
    assert.equal((call!.init?.headers as Record<string, string>)["x-timbre-secret"], "s3cret");
    assert.deepEqual(JSON.parse(String(call!.init?.body)), { playlist_id: PLAYLIST.id, limit: 100 });
  } finally {
    stub.restore();
  }
});

test("a playlist that is not public is null, not an error", async () => {
  const stub = stubFetch(404, { detail: "No public playlist with that id." });
  try {
    assert.equal(await createYtMusicProvider(config).playlist(ctx, PLAYLIST.id, 100), null);
  } finally {
    stub.restore();
  }
});

test("an upstream failure still throws, so it is not mistaken for a missing playlist", async () => {
  const stub = stubFetch(502, { detail: "YouTube Music playlist failed." });
  try {
    await assert.rejects(
      createYtMusicProvider(config).playlist(ctx, PLAYLIST.id, 100),
      (error: unknown) => error instanceof ProviderError && error.kind === "transient",
    );
  } finally {
    stub.restore();
  }
});

test("an id that cannot be a playlist is refused without asking the sidecar", async () => {
  const stub = stubFetch(200, PLAYLIST);
  try {
    const provider = createYtMusicProvider(config);
    assert.equal(await provider.playlist(ctx, "RDAMVMfa5IWHDbftI", 100), null);
    assert.equal(await provider.playlist(ctx, "../../search", 100), null);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
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
  assert.ok(isYtMusicProvider(createYtMusicProvider(config)));
});
