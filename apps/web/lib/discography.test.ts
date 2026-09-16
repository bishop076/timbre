import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { DeezerUnavailable } from "./deezer.ts";
import { deezerIdFrom, fetchAlbum, fetchDiscography, findArtist } from "./discography.ts";

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
});

function answering(body: unknown) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

function answeringPath(reply: (path: string) => unknown) {
  globalThis.fetch = ((input: string | URL | Request) =>
    Promise.resolve(
      Response.json(reply(new URL(String(input instanceof Request ? input.url : input)).pathname)),
    )) as typeof fetch;
}

const ARTIST = "https://www.deezer.com/artist/399";

test("an artist id is read out of a Deezer profile link, and only out of one", () => {
  assert.equal(deezerIdFrom("https://www.deezer.com/artist/399"), "399");
  assert.equal(deezerIdFrom("https://www.deezer.com/en/artist/399?utm=x"), "399");
  assert.equal(deezerIdFrom("https://www.deezer.com/album/399"), null);
  assert.equal(deezerIdFrom(null), null);
});

const RADIOHEAD = {
  name: "Radiohead",
  nb_fan: 4_000_000,
  link: "https://www.deezer.com/artist/399",
  picture_xl: "https://cdn-images.dzcdn.net/images/artist/x/1000x1000-000000-80-0-0.jpg",
};
const TRIBUTE = { name: "Radiohead Tribute Band", nb_fan: 500, link: "https://www.deezer.com/artist/1" };

test("the namesake with the reach wins, not whoever Deezer listed first", async () => {
  answering({ data: [TRIBUTE, RADIOHEAD] });
  const artist = await findArtist("Radiohead");
  assert.equal(artist?.name, "Radiohead");
  assert.equal(artist?.url, "https://www.deezer.com/artist/399");
  assert.equal(artist?.imageUrl, RADIOHEAD.picture_xl);
  assert.equal(artist?.followers, 4_000_000);
});

test("a name nobody in the catalogue answers to is nobody", async () => {
  answering({ data: [] });
  assert.equal(await findArtist("Radiohead"), null);
  assert.equal(await findArtist("   "), null);
});

// The page this feeds is `force-static` with an hour's `revalidate`. A rate limit read as an
// absence is an hour of "Nothing found for Radiohead" served from the cache, long after Deezer
// stopped refusing — so the search takes the strict read and lets the error boundary say so.
test("a refusal is a failure, not an absence", async () => {
  answering({ error: { type: "Exception", message: "Quota limit exceeded", code: 4 } });
  await assert.rejects(() => findArtist("Radiohead"), DeezerUnavailable);

  globalThis.fetch = (async () => {
    throw new DOMException("The operation timed out.", "TimeoutError");
  }) as typeof fetch;
  await assert.rejects(() => findArtist("Radiohead"), DeezerUnavailable);
});

// The input that reached production: Deezer up, answering 200, one album row carrying no
// `title`. The dedupe in `fetchDiscography` reads `album.title.trim()` on every row before
// anything else looks at one, so that row took the whole discography down with it —
// `TypeError: Cannot read properties of undefined (reading 'trim')`, a bare 500 out of
// `/api/artist?full=1` and the error boundary on `/artist/<name>`.
test("an album row Deezer sent without a title is one release short, not a broken page", async () => {
  answeringPath((path) =>
    path.endsWith("/related")
      ? { data: [] }
      : { data: [{ id: 1, release_date: "2000-10-02" }, { id: 2, title: "Kid A" }] },
  );

  const { releases } = await fetchDiscography(ARTIST);
  assert.deepEqual(
    releases.map((release) => release.title),
    ["Kid A"],
  );
});

// The shelf stays forgiving and the discography does not: an empty shelf is a shelf, an empty
// discography is a claim, and this panel is cached for a day.
test("a related shelf Deezer garbled is an empty shelf; a garbled album list is a failure", async () => {
  answeringPath((path) =>
    path.endsWith("/related") ? { data: [null, { picture_medium: "x" }] } : { data: [{ id: 1, title: "Kid A" }] },
  );
  assert.deepEqual(await fetchDiscography(ARTIST), {
    releases: [{ id: 1, title: "Kid A", kind: "album", year: null, coverUrl: null, trackCount: null }],
    related: [],
  });

  answeringPath((path) => (path.endsWith("/related") ? { data: [] } : { data: "not a list" }));
  await assert.rejects(() => fetchDiscography(ARTIST), DeezerUnavailable);
});

test("a search hit with no name is not a candidate, and cannot be the winner", async () => {
  answering({ data: [{ nb_fan: 9_000_000 }, { name: "Radiohead", nb_fan: 10, link: ARTIST }] });
  assert.equal((await findArtist("Radiohead"))?.name, "Radiohead");
});

// `fetchAlbum` is read on a `force-static` page that turns null into `notFound()`. A body that
// is not an album establishes no such thing, so it must not be cached as one — and a track row
// this cannot read used to arrive as `deezer:undefined` with no title at all.
test("an album Deezer garbled is a failure; one garbled track in it is one track fewer", async () => {
  answering({
    id: 5,
    title: "Kid A",
    tracks: { data: [{ id: 1, title: "Everything In Its Right Place" }, null, { id: {} }] },
  });
  const album = await fetchAlbum("5");
  assert.deepEqual(
    album?.songs.map((song) => song.title),
    ["Everything In Its Right Place"],
  );

  answering({ id: 5 });
  await assert.rejects(() => fetchAlbum("5"), DeezerUnavailable);
});
