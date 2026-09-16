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

// The input that closed `queryRoute`'s missing `try`, and then the boundary underneath it:
// Deezer up, answering 200, one album row with no `title`. That read went through a TypeScript
// `interface` and a cast, never zod, so `album.title.trim()` threw a `TypeError` — a `500` on a
// production build, from a request that was perfectly well formed, over a discography Deezer had
// sent in full bar one row. The row is now parsed and dropped, which is the answer: one release
// short, served and cacheable, rather than the whole artist page broken.
test("one album row Deezer garbled is one release missing, not a broken artist", async () => {
  upstream((url) =>
    url.pathname.startsWith("/search/")
      ? Response.json(RADIOHEAD)
      : Response.json({
          data: [{ id: 1, release_date: "2000-10-02" }, { id: 2, title: "Kid A" }],
        }),
  );
  const response = await ask("name=Radiohead&full=1");

  assert.equal(response.status, 200);
  const body = (await response.json()) as { releases: { title: string }[] };
  assert.deepEqual(
    body.releases.map((release) => release.title),
    ["Kid A"],
  );
});

// A row that cannot be read is one row; a body that is not a list of rows is Deezer failing, and
// this panel is served with a day of `s-maxage` behind a week of `stale-while-revalidate`. Read
// as "Radiohead has released nothing" it would have published that to every reader for the day.
test("an album list that is not a list is a 502, never an empty discography", async () => {
  upstream((url) =>
    url.pathname.startsWith("/search/")
      ? Response.json(RADIOHEAD)
      : Response.json({ data: "not a list" }),
  );
  const response = await ask("name=Radiohead&full=1");

  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(((await response.json()) as { error: string }).error, /Deezer/);
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
