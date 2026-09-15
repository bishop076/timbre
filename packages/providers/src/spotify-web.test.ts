import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { MemoryBucketStore, ProviderError, RateLimiter } from "@timbre/core";

import {
  albumFromResponse,
  chunkUrl,
  collectionFromEmbed,
  fetchSpotifyCollection,
  hashesFrom,
  healedSpotifyHashes,
  isFresh,
  SPOTIFY_OPERATIONS,
  pathfinderUrl,
  playlistFromResponse,
  resetSpotifyWebSession,
  searchSpotifyWeb,
  sessionFromEmbed,
  tracksFromSearch,
} from "./spotify-web.ts";

const ctx = { limiter: new RateLimiter(new MemoryBucketStore()) };

const TRACK_ID = "0DiWol3AO6WpXZgp0goxAV";
const ALBUM_ID = "2noRn2Aes5aoNVsU6iWThc";
const COVER = "https://i.scdn.co/image/300";

const nextData = (state: unknown) =>
  `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state } } })}</script>`;

const embedPage = (token: string, expiresInMs: number) =>
  nextData({ settings: { session: { accessToken: token, accessTokenExpirationTimestampMs: Date.now() + expiresInMs } } });

const RAW_TRACK = {
  __typename: "Track",
  name: "One More Time",
  artists: { items: [{ profile: { name: "Daft Punk" } }] },
  playability: { playable: true },
};

const SEARCH = {
  data: {
    searchV2: {
      tracksV2: {
        items: [
          {
            item: {
              data: {
                ...RAW_TRACK,
                id: TRACK_ID,
                duration: { totalMilliseconds: 320357 },
                albumOfTrack: {
                  name: "Discovery",
                  coverArt: {
                    sources: [
                      { url: "https://i.scdn.co/image/64", width: 64 },
                      { url: COVER, width: 300 },
                      { url: "https://i.scdn.co/image/640", width: 640 },
                    ],
                  },
                },
              },
            },
          },
          { item: { data: { ...RAW_TRACK, id: "5W3cjX2J3tjhG8zb6u0qHn", playability: { playable: false } } } },
        ],
      },
    },
  },
};

type Route = [match: string, respond: () => Response];
type Call = { url: string; auth: string | null };

async function withRoutes(routes: Route[], run: (calls: Call[]) => Promise<void>): Promise<void> {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
    const index = routes.findIndex(([match]) => url.includes(match));
    return index === -1 ? new Response("{}", { status: 404 }) : routes.splice(index, 1)[0]![1]();
  }) as typeof fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

const json = (body: unknown, status = 200) => () => Response.json(body, { status });
const html = (body: string) => () => new Response(body);
const token = (value = "tok", expiresInMs = 50 * 60_000): Route => ["/embed/track/", html(embedPage(value, expiresInMs))];
const search = (respond: () => Response): Route => ["operationName=searchDesktop", respond];
const FOUND = search(json(SEARCH));
const RETIRED = search(json({ errors: [{ message: "PersistedQueryNotFound" }] }));
const sentHash = (url: string) => JSON.parse(new URL(url).searchParams.get("extensions")!).persistedQuery;

afterEach(() => resetSpotifyWebSession());

test("the embed page's own session is read, and a page without one is not guessed at", () => {
  assert.equal(sessionFromEmbed(embedPage("abc", 60_000))?.token, "abc");
  assert.equal(sessionFromEmbed("<html>no script here</html>"), null);
  assert.equal(sessionFromEmbed(nextData(undefined)), null);
});

/**
 * The embed page is read from the network, so the scan over it has to be linear in its length.
 *
 * The regex that used to do this restarted at every `__NEXT_DATA__` opening tag and walked the
 * rest of the document from each one. Measured before the fix: 2.5 ms at 30 KB, 245 ms at
 * 300 KB, 31.8 s at 3 MB — and all of it blocking the event loop, so a single page like this
 * stalled every other request the instance was serving. The bound below is far looser than the
 * few milliseconds the linear version takes; it only has to fail if the quadratic scan returns.
 */
test("a page built to make the scan quadratic is read in milliseconds, not seconds", () => {
  const hostile = '<script id="__NEXT_DATA__" type="application/json">'.repeat(30_000);
  assert.ok(hostile.length > 1_500_000, "the page has to be big enough for n squared to show");

  const started = performance.now();
  assert.equal(sessionFromEmbed(hostile), null);
  const took = performance.now() - started;
  assert.ok(took < 500, `reading an unclosed ${hostile.length}-char page took ${took.toFixed(0)}ms`);
});

test("a token is only used while it has more than a couple of minutes left", () => {
  const now = 1_000_000;
  assert.equal(isFresh({ token: "t", expiresAt: now + 10 * 60_000 }, now), true);
  assert.equal(isFresh({ token: "t", expiresAt: now + 60_000 }, now), false);
  assert.equal(isFresh(null, now), false);
});

test("search reads tracks, prefers the 300px cover, and drops what cannot play", () => {
  assert.deepEqual(tracksFromSearch(SEARCH.data), [
    {
      source: "spotify",
      sourceId: TRACK_ID,
      title: "One More Time",
      artists: ["Daft Punk"],
      album: "Discovery",
      durationMs: 320357,
      isrc: null,
      url: `https://open.spotify.com/track/${TRACK_ID}`,
      artworkUrl: COVER,
      playback: "manual",
    },
  ]);
});

test("the query travels as a persisted-query GET naming the operation and its hash", () => {
  const url = new URL(pathfinderUrl("search", { searchTerm: "a&b" }));
  assert.equal(url.searchParams.get("operationName"), "searchDesktop");
  assert.deepEqual(JSON.parse(url.searchParams.get("variables")!), { searchTerm: "a&b" });
  assert.deepEqual(sentHash(url.href), { version: 1, sha256Hash: SPOTIFY_OPERATIONS.search.sha256 });
});

test("a search bootstraps one token and sends it as the bearer", () =>
  withRoutes([token("tok-1"), FOUND, FOUND], async (calls) => {
    assert.equal((await searchSpotifyWeb(ctx, "one more time")).length, 1);
    await searchSpotifyWeb(ctx, "discovery");
    assert.equal(calls.filter((call) => call.url.includes("/embed/")).length, 1);
    assert.deepEqual(calls.slice(1).map((call) => call.auth), ["Bearer tok-1", "Bearer tok-1"]);
  }));

const tokenCases: [string, Route[], string][] = [
  ["a nearly spent token is traded for a fresher one before use", [token("spent", 30_000), token("fresh"), FOUND], "fresh"],
  [
    "a 401 is retried once on a new token, since tokens can die before their stated expiry",
    [token("revoked"), search(json({}, 401)), token("second"), FOUND],
    "second",
  ],
];

for (const [name, routes, used] of tokenCases) {
  test(name, () =>
    withRoutes(routes, async (calls) => {
      assert.equal((await searchSpotifyWeb(ctx, "x")).length, 1);
      assert.equal(calls.at(-1)?.auth, `Bearer ${used}`);
    }),
  );
}

test("a blank query or a malformed id asks nothing of Spotify", () =>
  withRoutes([], async (calls) => {
    assert.deepEqual(await searchSpotifyWeb(ctx, "   "), []);
    assert.equal(await fetchSpotifyCollection(ctx, "playlist", "../../etc"), null);
    assert.equal(calls.length, 0);
  }));

const NEW_SEARCH = "a".repeat(64);
const NEW_ALBUM = "b".repeat(64);
const NEW_PLAYLIST = "d".repeat(64);
const MAIN = "https://open.spotifycdn.com/cdn/build/web-player/web-player.2c51c6eb.js";

const MAIN_BUNDLE = [
  `let n=new i.l("getAlbum","query","${NEW_ALBUM}",null),a=new i.l("queryAlbumTracks","query","${"c".repeat(64)}",null);`,
  `const p=new i.l("fetchPlaylist","query","${NEW_PLAYLIST}",null);`,
  `u.u=e=>""+(({1328:"xpui-pip-mini-player",4406:"xpui-routes-search",2706:"xpui-routes-recent-searches"})[e]||e)`,
  `+"."+({1328:"0a1b2c3d",2706:"11223344",4406:"6c2f9e1a",9932:"7a16468d"})[e]+".js",u.miniCssF=e=>"x"`,
].join("");
const SEARCH_CHUNK = `var q=new s.l("searchDesktop","query","${NEW_SEARCH}",null);`;
const PYTHON = `SEARCH_OPERATION = Operation(\n    "searchDesktop",\n    "${NEW_SEARCH}",\n    lambda query: {},\n)\n"album": Operation(\n        "getAlbum",\n        "${NEW_ALBUM}",`;

test("persisted-query hashes are read from Spotify's bundle and SpotifyScraper's table alike", () => {
  assert.deepEqual(hashesFrom("bundle", MAIN_BUNDLE), { album: NEW_ALBUM, playlist: NEW_PLAYLIST });
  assert.deepEqual(hashesFrom("bundle", SEARCH_CHUNK), { search: NEW_SEARCH });
  assert.deepEqual(hashesFrom("upstream", PYTHON), { search: NEW_SEARCH, album: NEW_ALBUM });
  for (const operation of Object.values(SPOTIFY_OPERATIONS)) assert.match(operation.sha256, /^[0-9a-f]{64}$/);
});

test("the search chunk is located through the loader's name and hash maps", () => {
  assert.equal(
    chunkUrl(MAIN_BUNDLE, MAIN, "xpui-routes-search"),
    "https://open.spotifycdn.com/cdn/build/web-player/xpui-routes-search.6c2f9e1a.js",
  );
  assert.equal(chunkUrl("no loader here", MAIN, "xpui-routes-search"), null);
});

test("a retired hash with no findable successor fails loudly rather than looking like no results", () =>
  withRoutes([token(), RETIRED], async () => {
    await assert.rejects(searchSpotifyWeb(ctx, "x"), (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.match(error.message, /searchDesktop/);
      return true;
    });
  }));

test("a Spotify that accepts and then says nothing is Spotify's failure, not a bare DOMException", () =>
  withRoutes([["/embed/track/", () => { throw new DOMException("timed out", "TimeoutError"); }]], async () => {
    await assert.rejects(searchSpotifyWeb(ctx, "x"), (error: unknown) => {
      // `resolveUrl` and `/api/spotify/search` both branch on `ProviderError`; a raw
      // `TimeoutError` slipped past both and was reported as something other than an outage.
      assert.ok(error instanceof ProviderError, `got ${(error as Error)?.constructor?.name}`);
      assert.equal(error.provider, "spotify");
      assert.equal(error.kind, "transient");
      assert.equal(error.message, "Spotify did not answer within 6s.");
      return true;
    });
  }));

test("an HTML error page served as a 200 is Spotify's failure, not a raw SyntaxError", () =>
  withRoutes([token(), search(() => new Response("<html>502 Bad Gateway</html>"))], async () => {
    await assert.rejects(searchSpotifyWeb(ctx, "x"), {
      name: "ProviderError",
      kind: "transient",
      message: "Spotify returned an unreadable body.",
    });
  }));

const repairCases: [string, Route[], boolean][] = [
  [
    "a retired hash is replaced from Spotify's own bundle and the query retried",
    [
      ["open.spotify.com/search", html(`<script src="${MAIN}"></script>`)],
      ["web-player.2c51c6eb.js", html(MAIN_BUNDLE)],
      ["xpui-routes-search.6c2f9e1a.js", html(SEARCH_CHUNK)],
    ],
    false,
  ],
  ["when Spotify's bundle cannot be read, SpotifyScraper's table supplies the successor", [["SpotifyScraper", html(PYTHON)]], true],
];

for (const [name, sources, upstream] of repairCases) {
  test(name, () =>
    withRoutes([token(), RETIRED, ...sources, FOUND], async (calls) => {
      assert.equal((await searchSpotifyWeb(ctx, "x")).length, 1);
      assert.equal(sentHash(calls.at(-1)!.url).sha256Hash, NEW_SEARCH);
      assert.deepEqual(healedSpotifyHashes(), { search: NEW_SEARCH });
      assert.equal(calls.some((call) => call.url.includes("githubusercontent")), upstream);
    }),
  );
}

const NEWER_SEARCH = "f".repeat(64);
const table = (hash: string) => html(`SEARCH_OPERATION = Operation(\n    "searchDesktop",\n    "${hash}",\n)`);
const scraper = (hash: string): Route => ["SpotifyScraper", table(hash)];
const crawls = (calls: Call[]) => calls.filter((call) => call.url.includes("SpotifyScraper")).length;

// Spotify rotates a persisted query on a deploy, and deploys more than once in half an hour.
// The second repair used to be handed the first repair's reading straight out of the discovery
// memo, see it naming the hash that had just been refused, and throw "no replacement could be
// found" — without a single request going out to look for the successor that was sitting there.
// Search then stayed broken for the rest of the memo's thirty minutes.
test("a hash rotated twice inside the memo's lifetime is still repaired the second time", () =>
  withRoutes(
    [token(), RETIRED, scraper(NEW_SEARCH), FOUND, RETIRED, scraper(NEWER_SEARCH), FOUND],
    async (calls) => {
      assert.equal((await searchSpotifyWeb(ctx, "x")).length, 1);
      assert.deepEqual(healedSpotifyHashes(), { search: NEW_SEARCH });

      assert.equal((await searchSpotifyWeb(ctx, "y")).length, 1);
      assert.deepEqual(healedSpotifyHashes(), { search: NEWER_SEARCH });
      assert.equal(sentHash(calls.at(-1)!.url).sha256Hash, NEWER_SEARCH);
      assert.equal(crawls(calls), 2, "the second rotation needed a reading of its own");
    },
  ));

// The other half of the same bargain: re-reading on every refusal would send every later request
// back to Spotify's CDN for as long as a genuinely retired query kept being asked for.
test("the same refusal twice over is answered from the reading already taken", () =>
  withRoutes([token(), RETIRED, scraper(SPOTIFY_OPERATIONS.search.sha256), RETIRED], async (calls) => {
    for (const query of ["x", "y"]) await assert.rejects(searchSpotifyWeb(ctx, query), ProviderError);
    assert.equal(crawls(calls), 1);
  }));

test("a bundle from anywhere but Spotify's CDN is not read, and the second source is a pinned commit", () =>
  withRoutes(
    [
      token(),
      RETIRED,
      ["open.spotify.com/search", html(`<script src="https://evil.example/cdn/web-player.2c51c6eb.js"></script>`)],
      ["SpotifyScraper", html(PYTHON)],
      FOUND,
    ],
    async (calls) => {
      assert.equal((await searchSpotifyWeb(ctx, "x")).length, 1);
      assert.equal(calls.some((call) => call.url.includes("evil.example")), false);
      const table = calls.find((call) => call.url.includes("SpotifyScraper"))?.url;
      assert.match(table ?? "", /\/SpotifyScraper\/[0-9a-f]{40}\//);
    },
  ));

test("album tracks borrow the album's title and sleeve, which they do not carry themselves", () => {
  const album = albumFromResponse(ALBUM_ID, {
    albumUnion: {
      __typename: "Album",
      name: "Discovery",
      date: { isoString: "2001-03-12T00:00:00Z" },
      artists: RAW_TRACK.artists,
      coverArt: { sources: [{ url: COVER, width: 300 }] },
      tracksV2: {
        totalCount: 14,
        items: [{ track: { ...RAW_TRACK, uri: `spotify:track:${TRACK_ID}`, duration: { totalMilliseconds: 320357 } } }],
      },
    },
  });

  assert.deepEqual(
    { title: album?.title, by: album?.by, year: album?.year, total: album?.total },
    { title: "Discovery", by: "Daft Punk", year: "2001", total: 14 },
  );
  assert.equal(album?.tracks[0]?.sourceId, TRACK_ID);
  assert.equal(album?.tracks[0]?.album, "Discovery");
  assert.equal(album?.tracks[0]?.artworkUrl, COVER);
});

test("a playlist keeps its songs, skips its podcast episodes, and credits its owner", () => {
  const playlist = playlistFromResponse("37i9dQZF1DXcBWIGoYBM5M", {
    playlistV2: {
      __typename: "Playlist",
      name: "Today's Top Hits",
      ownerV2: { data: { name: "Spotify" } },
      images: { items: [{ sources: [{ url: "https://i.scdn.co/image/mosaic", width: null }] }] },
      content: {
        totalCount: 50,
        items: [
          {
            itemV2: {
              __typename: "TrackResponseWrapper",
              data: { ...RAW_TRACK, uri: `spotify:track:${TRACK_ID}`, trackDuration: { totalMilliseconds: 320357 } },
            },
          },
          { itemV2: { __typename: "EpisodeResponseWrapper", data: { name: "A podcast" } } },
        ],
      },
    },
  });

  assert.equal(playlist?.by, "Spotify");
  assert.equal(playlist?.coverUrl, "https://i.scdn.co/image/mosaic");
  assert.equal(playlist?.tracks.length, 1);
  assert.equal(playlist?.tracks[0]?.durationMs, 320357);
});

test("a missing album or playlist is null, not an empty collection", () => {
  assert.equal(albumFromResponse(ALBUM_ID, { albumUnion: { __typename: "NotFound" } }), null);
  assert.equal(playlistFromResponse(ALBUM_ID, null), null);
});

const ALBUM_EMBED = nextData({
  data: {
    entity: {
      name: "Discovery",
      subtitle: "Daft Punk",
      releaseDate: { isoString: "2001-03-12T00:00:00Z" },
      visualIdentity: { image: [{ url: "https://img/300", maxWidth: 300 }, { url: "https://img/640", maxWidth: 640 }] },
      trackList: [
        {
          uri: `spotify:track:${TRACK_ID}`,
          title: "One More Time",
          subtitle: "Daft Punk, Romanthony",
          duration: 320357,
          isPlayable: true,
          audioPreview: { url: "https://p.scdn.co/mp3-preview/abc" },
        },
        { uri: "spotify:track:5W3cjX2J3tjhG8zb6u0qHn", title: "Gone", isPlayable: false },
      ],
    },
  },
});

test("an embed page's track list stands in for pathfinder, preview clips included", () => {
  const album = collectionFromEmbed("album", ALBUM_ID, ALBUM_EMBED);
  assert.deepEqual(
    { title: album?.title, by: album?.by, year: album?.year, coverUrl: album?.coverUrl, count: album?.tracks.length },
    { title: "Discovery", by: "Daft Punk", year: "2001", coverUrl: "https://img/640", count: 1 },
  );
  assert.deepEqual(album?.tracks[0]?.artists, ["Daft Punk", "Romanthony"]);
  assert.equal(album?.tracks[0]?.previewUrl, "https://p.scdn.co/mp3-preview/abc");
  assert.equal(collectionFromEmbed("album", ALBUM_ID, "<html></html>"), null);

  // The clip is set as an `<audio src>`, so the host in it is a host the listener's browser
  // connects to. An embed page is HTML scraped off the network, and this is the one field on a
  // live result that does not go through `/api/art`.
  const elsewhere = ALBUM_EMBED.replace("https://p.scdn.co/mp3-preview/abc", "https://evil.example/x.mp3");
  assert.equal(collectionFromEmbed("album", ALBUM_ID, elsewhere)?.tracks[0]?.previewUrl, null);
});

test("an album still opens when pathfinder is down, from its embed page", () =>
  withRoutes(
    [token(), ["operationName=getAlbum", json({}, 503)], [`/embed/album/${ALBUM_ID}`, html(ALBUM_EMBED)]],
    async () => {
      const album = await fetchSpotifyCollection(ctx, "album", ALBUM_ID);
      assert.equal(album?.title, "Discovery");
      assert.equal(album?.tracks[0]?.sourceId, TRACK_ID);
    },
  ));
