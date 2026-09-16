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
const BJORK = { data: [{ name: "Björk", nb_fan: 900_000, link: "https://www.deezer.com/artist/222" }] };

const ask = (query: string) => GET(new Request(`http://timbre.test/api/taste?${query}`));

test("a Deezer refusal on the name lookup is a 502, not a 500", async () => {
  upstream(() => Response.json(QUOTA));
  const response = await ask("artist=Bj%C3%B6rk");

  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

// `taste-store.ts` writes what a 200 carries into the reader's own browser and will not ask again
// for a week, so a release shelf forgiven into `[]` outlives the outage on the CDN *and* in every
// browser that happened to be listening through it.
test("a Deezer refusal on the release shelf is never served as a 200", async () => {
  upstream((url) => (url.pathname.startsWith("/search/") ? Response.json(BJORK) : Response.json(QUOTA)));
  const response = await ask("artist=Bj%C3%B6rk");

  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("a whole answer is still served, and still cacheable", async () => {
  upstream((url) =>
    url.pathname.startsWith("/search/")
      ? Response.json(BJORK)
      : Response.json({
          data: [{ id: 7, title: "Vespertine", release_date: "2001-08-27", genre_id: 132 }],
        }),
  );
  const response = await ask("artist=Bj%C3%B6rk");

  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /s-maxage=86400/);
  const { taste } = (await response.json()) as { taste: { releases: { title: string }[] } };
  assert.deepEqual(
    taste.releases.map((release) => release.title),
    ["Vespertine"],
  );
});
