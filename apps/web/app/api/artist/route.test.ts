import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { GET } from "./route.ts";

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
});

type Reply = (url: URL) => Response;

function upstream(reply: Reply) {
  globalThis.fetch = ((input: string | URL | Request) =>
    Promise.resolve(reply(new URL(String(input instanceof Request ? input.url : input))))) as typeof fetch;
}

const QUOTA = { error: { type: "Exception", message: "Quota limit exceeded", code: 4 } };
const RADIOHEAD = {
  data: [{ name: "Radiohead", nb_fan: 4_000_000, link: "https://www.deezer.com/artist/399" }],
};

const ask = (query: string) => GET(new Request(`http://timbre.test/api/artist?${query}`));

// Measured against a production build: eight of sixty concurrent lookups came back `500` with an
// empty body and no cache directives, because Deezer had started refusing and nothing between
// `deezerOrFail` and the platform caught it. A 500 says Timbre broke.
test("a Deezer refusal on the name lookup is a 502, not a 500", async () => {
  upstream(() => Response.json(QUOTA));
  const response = await ask("name=Radiohead");

  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match((await response.json()).error, /Deezer/);
});

// The panel this fills is served with a day of `s-maxage` and a week of `stale-while-revalidate`,
// so an album list forgiven into `[]` published "Radiohead has released nothing" to everyone who
// searched that name for the rest of the day.
test("a Deezer refusal on the album list is never cached as an empty discography", async () => {
  upstream((url) => (url.pathname.startsWith("/search/") ? Response.json(RADIOHEAD) : Response.json(QUOTA)));
  const response = await ask("name=Radiohead&full=1");

  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("a name nobody answers to is still an answer, not a failure", async () => {
  upstream(() => Response.json({ data: [] }));
  const response = await ask("name=Radiohead");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { artist: null });
});

test("a whole answer is still served, and still cacheable", async () => {
  upstream((url) =>
    url.pathname.startsWith("/search/")
      ? Response.json(RADIOHEAD)
      : Response.json({ data: [{ id: 1, title: "Kid A", release_date: "2000-10-02" }] }),
  );
  const response = await ask("name=Radiohead&full=1");

  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /s-maxage=86400/);
  const body = (await response.json()) as { artist: { name: string }; releases: { title: string }[] };
  assert.equal(body.artist.name, "Radiohead");
  assert.deepEqual(
    body.releases.map((release) => release.title),
    ["Kid A"],
  );
});
