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

/**
 * The sidecar declares a `response_model` on every route, so a healthy one cannot send any of
 * these. That is an argument for the shape being reliable, not for trusting it: the URL is
 * configuration, and until this was checked a single track with a null `artists` did not fail
 * the YouTube Music provider — it failed the whole search. `searchAll` catches what a provider
 * throws, then ranks and merges the pooled result *outside* that guard, so Apple's and Deezer's
 * good answers went down with it.
 */
const misshapen: [string, unknown, () => Promise<unknown>][] = [
  ["search with no list at all", {}, () => provider.search(ctx, "x", 5)],
  ["search with a null list", { items: null }, () => provider.search(ctx, "x", 5)],
  ["radio with no lists", {}, () => provider.radio!(ctx, { sourceId: "v" }, 5)],
  ["a playlist with no track list", { ...PLAYLIST, tracks: "all of them" }, () => provider.playlist(ctx, PLAYLIST.id, 5)],
];

for (const [name, body, ask] of misshapen) {
  test(`${name} is this source failing, not a TypeError out of the search route`, () =>
    withSidecar(200, body, async () => {
      await assert.rejects(ask(), (error: unknown) => {
        assert.ok(error instanceof ProviderError, `got ${(error as Error)?.constructor?.name}`);
        assert.equal(error.provider, "ytmusic");
        assert.match(error.message, /YouTube Music sidecar/);
        return true;
      });
    }));
}

test("one unreadable track is dropped, and the rest of the page still arrives", () =>
  withSidecar(
    200,
    { items: [{ ...PLAYLIST.tracks[0], artists: null }, { video_id: null, title: "No id" }, { title: "No id either" }] },
    async () => {
      const tracks = await provider.search(ctx, "x", 5);
      assert.equal(tracks.length, 1, "the two tracks with no id are dropped, the readable one is not");
      assert.deepEqual(tracks[0]?.artists, [], "a null credit list becomes no credits, not a crash downstream");
      assert.equal(tracks[0]?.title, "ceiling duty");
    },
  ));
