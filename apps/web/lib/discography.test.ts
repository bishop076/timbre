import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { DeezerUnavailable } from "./deezer.ts";
import { deezerIdFrom, findArtist } from "./discography.ts";

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
