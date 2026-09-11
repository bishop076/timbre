import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { MemoryBucketStore, ProviderError, RateLimiter } from "@timbre/core";

import {
  albumFromResponse,
  chunkUrl,
  collectionFromEmbed,
  fetchSpotifyCollection,
  hashesFromBundle,
  hashesFromUpstream,
  healedSpotifyHashes,
  isFresh,
  SPOTIFY_OPERATIONS,
  pathfinderUrl,
  playlistFromResponse,
  resetSpotifyWebSession,
  searchSpotifyWeb,
  sessionFromEmbed,
  spotifyCollectionOf,
  tracksFromSearch,
} from "./spotify-web.ts";

const ctx = { limiter: new RateLimiter(new MemoryBucketStore()) };

const TRACK_ID = "0DiWol3AO6WpXZgp0goxAV";
const ALBUM_ID = "2noRn2Aes5aoNVsU6iWThc";

function embedPage(token: string, expiresInMs: number): string {
  const data = {
    props: {
      pageProps: {
        state: {
          settings: {
            session: { accessToken: token, accessTokenExpirationTimestampMs: Date.now() + expiresInMs, isAnonymous: true },
          },
        },
      },
    },
  };
  return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></html>`;
}

const SEARCH = {
  data: {
    searchV2: {
      tracksV2: {
        items: [
          {
            item: {
              data: {
                __typename: "Track",
                id: TRACK_ID,
                name: "One More Time",
                duration: { totalMilliseconds: 320357 },
                artists: { items: [{ profile: { name: "Daft Punk" } }] },
                playability: { playable: true },
                albumOfTrack: {
                  id: ALBUM_ID,
                  name: "Discovery",
                  coverArt: {
                    sources: [
                      { url: "https://i.scdn.co/image/64", width: 64, height: 64 },
                      { url: "https://i.scdn.co/image/300", width: 300, height: 300 },
                      { url: "https://i.scdn.co/image/640", width: 640, height: 640 },
                    ],
                  },
                },
              },
            },
          },
          {
            item: {
              data: {
                __typename: "Track",
                id: "5W3cjX2J3tjhG8zb6u0qHn",
                name: "Gone",
                playability: { playable: false },
              },
            },
          },
        ],
      },
    },
  },
};

interface Route {
  match: string;
  respond: () => Response;
}

function stubFetch(routes: Route[]) {
  const calls: { url: string; auth: string | null }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
    const index = routes.findIndex((route) => url.includes(route.match));
    if (index === -1) return new Response("{}", { status: 404 });
    const [route] = routes.splice(index, 1);
    return route!.respond();
  }) as typeof globalThis.fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

const json = (body: unknown, status = 200) => () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const html = (body: string) => () => new Response(body, { status: 200, headers: { "content-type": "text/html" } });

afterEach(() => resetSpotifyWebSession());

test("the embed page's own session is read, and a page without one is not guessed at", () => {
  const session = sessionFromEmbed(embedPage("abc", 60_000));
  assert.equal(session?.token, "abc");
  assert.equal(sessionFromEmbed("<html>no script here</html>"), null);
  assert.equal(sessionFromEmbed('<script id="__NEXT_DATA__" type="application/json">{"props":{}}</script>'), null);
});

test("a token is only used while it has more than a couple of minutes left", () => {
  const now = 1_000_000;
  assert.equal(isFresh({ token: "t", expiresAt: now + 10 * 60_000 }, now), true);
  assert.equal(isFresh({ token: "t", expiresAt: now + 60_000 }, now), false);
  assert.equal(isFresh(null, now), false);
});

test("search reads tracks, prefers the 300px cover, and drops what cannot play", () => {
  const [track, ...rest] = tracksFromSearch(SEARCH.data);
  assert.equal(rest.length, 0);
  assert.deepEqual(track, {
    source: "spotify",
    sourceId: TRACK_ID,
    title: "One More Time",
    artists: ["Daft Punk"],
    album: "Discovery",
    durationMs: 320357,
    isrc: null,
    url: `https://open.spotify.com/track/${TRACK_ID}`,
    artworkUrl: "https://i.scdn.co/image/300",
    playback: "manual",
  });
});

test("a search bootstraps one token and sends it as the bearer", async () => {
  const stub = stubFetch([
    { match: "/embed/track/", respond: html(embedPage("tok-1", 50 * 60_000)) },
    { match: "operationName=searchDesktop", respond: json(SEARCH) },
    { match: "operationName=searchDesktop", respond: json(SEARCH) },
  ]);
  try {
    assert.equal((await searchSpotifyWeb(ctx, "one more time")).length, 1);
    await searchSpotifyWeb(ctx, "discovery");
    assert.equal(stub.calls.filter((call) => call.url.includes("/embed/")).length, 1);
    assert.equal(stub.calls[1]?.auth, "Bearer tok-1");
  } finally {
    stub.restore();
  }
});

test("a nearly spent token is traded for a fresher one before use", async () => {
  const stub = stubFetch([
    { match: "/embed/track/", respond: html(embedPage("spent", 30_000)) },
    { match: "/embed/track/", respond: html(embedPage("fresh", 40 * 60_000)) },
    { match: "operationName=searchDesktop", respond: json(SEARCH) },
  ]);
  try {
    await searchSpotifyWeb(ctx, "x");
    assert.equal(stub.calls.at(-1)?.auth, "Bearer fresh");
  } finally {
    stub.restore();
  }
});

test("a 401 is retried once on a new token, since tokens can die before their stated expiry", async () => {
  const stub = stubFetch([
    { match: "/embed/track/", respond: html(embedPage("revoked", 50 * 60_000)) },
    { match: "operationName=searchDesktop", respond: json({}, 401) },
    { match: "/embed/track/", respond: html(embedPage("second", 50 * 60_000)) },
    { match: "operationName=searchDesktop", respond: json(SEARCH) },
  ]);
  try {
    assert.equal((await searchSpotifyWeb(ctx, "x")).length, 1);
    assert.equal(stub.calls.at(-1)?.auth, "Bearer second");
  } finally {
    stub.restore();
  }
});

test("a retired hash with no findable successor fails loudly rather than looking like no results", async () => {
  const stub = stubFetch([
    { match: "/embed/track/", respond: html(embedPage("tok", 50 * 60_000)) },
    { match: "operationName=searchDesktop", respond: json({ errors: [{ message: "PersistedQueryNotFound" }] }) },
  ]);
  try {
    await assert.rejects(searchSpotifyWeb(ctx, "x"), (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.match(error.message, /searchDesktop/);
      return true;
    });
  } finally {
    stub.restore();
  }
});

test("a blank query asks nothing of Spotify", async () => {
  const stub = stubFetch([]);
  try {
    assert.deepEqual(await searchSpotifyWeb(ctx, "   "), []);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test("album tracks borrow the album's title and sleeve, which they do not carry themselves", () => {
  const album = albumFromResponse(ALBUM_ID, {
    albumUnion: {
      __typename: "Album",
      name: "Discovery",
      date: { isoString: "2001-03-12T00:00:00Z" },
      artists: { items: [{ profile: { name: "Daft Punk" } }] },
      coverArt: { sources: [{ url: "https://i.scdn.co/image/300", width: 300 }] },
      tracksV2: {
        totalCount: 14,
        items: [
          {
            track: {
              uri: `spotify:track:${TRACK_ID}`,
              name: "One More Time",
              duration: { totalMilliseconds: 320357 },
              artists: { items: [{ profile: { name: "Daft Punk" } }] },
              playability: { playable: true },
            },
          },
        ],
      },
    },
  });

  assert.equal(album?.title, "Discovery");
  assert.equal(album?.by, "Daft Punk");
  assert.equal(album?.year, "2001");
  assert.equal(album?.total, 14);
  assert.equal(album?.tracks[0]?.sourceId, TRACK_ID);
  assert.equal(album?.tracks[0]?.album, "Discovery");
  assert.equal(album?.tracks[0]?.artworkUrl, "https://i.scdn.co/image/300");
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
              data: {
                __typename: "Track",
                uri: `spotify:track:${TRACK_ID}`,
                name: "One More Time",
                trackDuration: { totalMilliseconds: 320357 },
                artists: { items: [{ profile: { name: "Daft Punk" } }] },
                playability: { playable: true },
              },
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

test("a malformed id is refused before anything is fetched", async () => {
  const stub = stubFetch([]);
  try {
    assert.equal(await fetchSpotifyCollection(ctx, "playlist", "../../etc"), null);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test("album and playlist links are recognised in every form Spotify hands out", () => {
  assert.deepEqual(spotifyCollectionOf(`https://open.spotify.com/album/${ALBUM_ID}`), { kind: "album", id: ALBUM_ID });
  assert.deepEqual(spotifyCollectionOf(`https://open.spotify.com/intl-de/playlist/${ALBUM_ID}?si=abc`), {
    kind: "playlist",
    id: ALBUM_ID,
  });
  assert.deepEqual(spotifyCollectionOf(`https://open.spotify.com/embed/album/${ALBUM_ID}`), { kind: "album", id: ALBUM_ID });
  assert.equal(spotifyCollectionOf(`https://open.spotify.com/track/${TRACK_ID}`), null);
  assert.equal(spotifyCollectionOf(`https://evil.example/album/${ALBUM_ID}`), null);
  assert.equal(spotifyCollectionOf("not a url"), null);
});

test("the query travels as a persisted-query GET naming the operation and its hash", () => {
  const url = new URL(pathfinderUrl("search", { searchTerm: "a&b" }));
  assert.equal(url.searchParams.get("operationName"), "searchDesktop");
  assert.deepEqual(JSON.parse(url.searchParams.get("variables")!), { searchTerm: "a&b" });
  assert.equal(JSON.parse(url.searchParams.get("extensions")!).persistedQuery.version, 1);
});

const NEW_SEARCH = "a".repeat(64);
const NEW_ALBUM = "b".repeat(64);
const NEW_PLAYLIST = "d".repeat(64);
const MAIN ="https://open.spotifycdn.com/cdn/build/web-player/web-player.2c51c6eb.js";

const MAIN_BUNDLE = [
  `let n=new i.l("getAlbum","query","${NEW_ALBUM}",null),a=new i.l("queryAlbumTracks","query","${"c".repeat(64)}",null);`,
  `const p=new i.l("fetchPlaylist","query","${NEW_PLAYLIST}",null);`,
  `u.u=e=>""+(({1328:"xpui-pip-mini-player",4406:"xpui-routes-search",2706:"xpui-routes-recent-searches"})[e]||e)`,
  `+"."+({1328:"0a1b2c3d",2706:"11223344",4406:"6c2f9e1a",9932:"7a16468d"})[e]+".js",u.miniCssF=e=>"x"`,
].join("");
const SEARCH_CHUNK = `var q=new s.l("searchDesktop","query","${NEW_SEARCH}",null);`;

test("persisted-query definitions are read out of a web-player script", () => {
  assert.deepEqual(hashesFromBundle(MAIN_BUNDLE), { album: NEW_ALBUM, playlist: NEW_PLAYLIST });
  assert.deepEqual(hashesFromBundle(SEARCH_CHUNK), { search: NEW_SEARCH });
});

test("the search chunk is located through the loader's name and hash maps", () => {
  assert.equal(
    chunkUrl(MAIN_BUNDLE, MAIN, "xpui-routes-search"),
    "https://open.spotifycdn.com/cdn/build/web-player/xpui-routes-search.6c2f9e1a.js",
  );
  assert.equal(chunkUrl("no loader here", MAIN, "xpui-routes-search"), null);
});

test("SpotifyScraper's table is read too, in its own Python shape", () => {
  const python = `SEARCH_OPERATION = Operation(\n    "searchDesktop",\n    "${NEW_SEARCH}",\n    lambda query: {},\n)\n"album": Operation(\n        "getAlbum",\n        "${NEW_ALBUM}",`;
  assert.deepEqual(hashesFromUpstream(python), { search: NEW_SEARCH, album: NEW_ALBUM });
});

test("a retired hash is replaced from Spotify's own bundle and the query retried", async () => {
  const stub = stubFetch([
    { match: "/embed/track/", respond: html(embedPage("tok", 50 * 60_000)) },
    { match: "operationName=searchDesktop", respond: json({ errors: [{ message: "PersistedQueryNotFound" }] }) },
    { match: "open.spotify.com/search", respond: html(`<script src="${MAIN}"></script>`) },
    { match: "web-player.2c51c6eb.js", respond: html(MAIN_BUNDLE) },
    { match: "xpui-routes-search.6c2f9e1a.js", respond: html(SEARCH_CHUNK) },
    { match: "operationName=searchDesktop", respond: json(SEARCH) },
  ]);
  try {
    assert.equal((await searchSpotifyWeb(ctx, "x")).length, 1);
    const retried = new URL(stub.calls.at(-1)!.url);
    assert.equal(JSON.parse(retried.searchParams.get("extensions")!).persistedQuery.sha256Hash, NEW_SEARCH);
    assert.deepEqual(healedSpotifyHashes(), { search: NEW_SEARCH });
    assert.ok(!stub.calls.some((call) => call.url.includes("githubusercontent")));
  } finally {
    stub.restore();
  }
});

test("when Spotify's bundle cannot be read, SpotifyScraper's table supplies the successor", async () => {
  const stub = stubFetch([
    { match: "/embed/track/", respond: html(embedPage("tok", 50 * 60_000)) },
    { match: "operationName=searchDesktop", respond: json({ errors: [{ message: "PersistedQueryNotFound" }] }) },
    { match: "SpotifyScraper", respond: html(`SEARCH_OPERATION = Operation(\n    "searchDesktop",\n    "${NEW_SEARCH}",`) },
    { match: "operationName=searchDesktop", respond: json(SEARCH) },
  ]);
  try {
    assert.equal((await searchSpotifyWeb(ctx, "x")).length, 1);
    assert.deepEqual(healedSpotifyHashes(), { search: NEW_SEARCH });
  } finally {
    stub.restore();
  }
});

test("the table starts from hashes shaped like hashes, one per operation used", () => {
  for (const operation of Object.values(SPOTIFY_OPERATIONS)) assert.match(operation.sha256, /^[0-9a-f]{64}$/);
});

const ALBUM_EMBED = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
  props: {
    pageProps: {
      state: {
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
      },
    },
  },
})}</script>`;

test("an embed page's track list stands in for pathfinder, preview clips included", () => {
  const album = collectionFromEmbed("album", ALBUM_ID, ALBUM_EMBED);
  assert.equal(album?.title, "Discovery");
  assert.equal(album?.by, "Daft Punk");
  assert.equal(album?.year, "2001");
  assert.equal(album?.coverUrl, "https://img/640");
  assert.equal(album?.tracks.length, 1);
  assert.deepEqual(album?.tracks[0]?.artists, ["Daft Punk", "Romanthony"]);
  assert.equal(album?.tracks[0]?.previewUrl, "https://p.scdn.co/mp3-preview/abc");
  assert.equal(collectionFromEmbed("album", ALBUM_ID, "<html></html>"), null);
});

test("an album still opens when pathfinder is down, from its embed page", async () => {
  const stub = stubFetch([
    { match: "/embed/track/", respond: html(embedPage("tok", 50 * 60_000)) },
    { match: "operationName=getAlbum", respond: json({}, 503) },
    { match: `/embed/album/${ALBUM_ID}`, respond: html(ALBUM_EMBED) },
  ]);
  try {
    const album = await fetchSpotifyCollection(ctx, "album", ALBUM_ID);
    assert.equal(album?.title, "Discovery");
    assert.equal(album?.tracks[0]?.sourceId, TRACK_ID);
  } finally {
    stub.restore();
  }
});
