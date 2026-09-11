import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryBucketStore, RateLimiter } from "@timbre/core";

import { createSpotifyProvider, findSpotifyTrackId } from "./spotify.ts";

const ctx = { limiter: new RateLimiter(new MemoryBucketStore()) };
const TRACK_ID = "0DiWol3AO6WpXZgp0goxAV";

async function withRoutes(routes: Record<string, unknown>, run: (calls: string[]) => Promise<void>): Promise<void> {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const hit = Object.keys(routes).find((match) => url.includes(match));
    if (!hit) return new Response("{}", { status: 404 });
    const body = routes[hit];
    return typeof body === "string" ? new Response(body) : Response.json(body);
  }) as typeof fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

const labsRows = (id: string) => [{ spotify_track_ids: [id] }];

const lookupCases: [string, Record<string, unknown>, Parameters<typeof findSpotifyTrackId>[1], string | null, string[]][] = [
  [
    "a known album resolves through the metadata route in one call",
    { "spotify-id-from-metadata": labsRows("FROM_METADATA_00000000") },
    { title: "One More Time", artist: "Daft Punk", album: "Discovery" },
    "FROM_METADATA_00000000",
    ["artist_name=Daft+Punk&release_name=Discovery&track_name=One+More+Time"],
  ],
  [
    "the id rides along with the ISRC lookup, costing no second request",
    {
      "/isrc/": {
        recordings: [{ id: "mbid-1", relations: [{ url: { resource: "https://open.spotify.com/track/2olIQt0rL0hOHau1SJ4xf2" } }] }],
      },
    },
    { title: "Get Lucky", isrc: "USQX91300108" },
    "2olIQt0rL0hOHau1SJ4xf2",
    ["/isrc/USQX91300108?inc=url-rels"],
  ],
  [
    "the dataset is still asked when nobody has linked the recording",
    {
      "/isrc/": { recordings: [{ id: "mbid-2", relations: [] }] },
      "spotify-id-from-mbid": labsRows("FROM_DATASET_000000000"),
    },
    { title: "Obscure", isrc: "GBAAA0000001" },
    "FROM_DATASET_000000000",
    ["/isrc/GBAAA0000001", "recording_mbid=mbid-2"],
  ],
  [
    "an ISRC MusicBrainz does not carry resolves to nothing, not to a guess",
    { "/isrc/": { recordings: [] } },
    { title: "Nowhere", isrc: "ZZAAA0000001" },
    null,
    ["/isrc/ZZAAA0000001"],
  ],
  ["with neither an album nor an ISRC there is nothing to ask", {}, { title: "Just a title" }, null, []],
];

for (const [name, routes, lookup, expected, asked] of lookupCases) {
  test(name, () =>
    withRoutes(routes, async (calls) => {
      assert.equal(await findSpotifyTrackId(ctx, lookup), expected);
      assert.equal(calls.length, asked.length);
      asked.forEach((part, index) => assert.ok(calls[index]?.includes(part), `${calls[index]} should carry ${part}`));
    }),
  );
}

const trackEmbed = (entity: unknown) =>
  `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } })}</script>`;
const resolve = (url: string) => createSpotifyProvider().resolve!(ctx, url);

test("a pasted track takes its artist, length and largest cover from the embed page", () =>
  withRoutes(
    {
      "/embed/track/": trackEmbed({
        title: "One More Time",
        artists: [{ name: "Daft Punk" }],
        duration: 320357,
        visualIdentity: { image: [{ url: "small", maxHeight: 64 }, { url: "large", maxHeight: 640 }] },
      }),
    },
    async (calls) => {
      const track = await resolve(`https://open.spotify.com/intl-de/track/${TRACK_ID}?si=x`);
      assert.deepEqual(
        { artists: track?.artists, durationMs: track?.durationMs, artworkUrl: track?.artworkUrl, url: track?.url },
        { artists: ["Daft Punk"], durationMs: 320357, artworkUrl: "large", url: `https://open.spotify.com/track/${TRACK_ID}` },
      );
      assert.equal(calls.length, 1);
    },
  ));

test("oEmbed stands in for an unreadable page; unplayable tracks and non-track links resolve to nothing", async () => {
  await withRoutes({ oembed: { title: "One More Time", thumbnail_url: "thumb" } }, async () => {
    const track = await resolve(`https://open.spotify.com/embed/track/${TRACK_ID}`);
    assert.deepEqual([track?.title, track?.artists, track?.artworkUrl], ["One More Time", [], "thumb"]);
  });
  await withRoutes({ "/embed/track/": trackEmbed({ title: "Gone", isPlayable: false }) }, async () => {
    assert.equal(await resolve(`https://open.spotify.com/track/${TRACK_ID}`), null);
  });
  assert.equal(await resolve("https://open.spotify.com/album/2noRn2Aes5aoNVsU6iWThc"), null);
});
