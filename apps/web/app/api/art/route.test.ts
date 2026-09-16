import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { GET } from "./route.ts";

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
});

function upstream(reply: () => Response | Promise<Response>) {
  globalThis.fetch = (() => Promise.resolve().then(reply)) as unknown as typeof fetch;
}

const COVER = "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg";
const ask = (url: string) =>
  GET(new Request(`http://timbre.test/api/art?u=${encodeURIComponent(url)}`));

// Everything this route can say other than "here is the cover". A failure a CDN holds is a
// placeholder that outlives the outage that caused it, which is the failure this guards against.
const failures: [string, string, number][] = [
  ["a missing url", "", 400],
  ["a url that is not one", "%%%not a url", 400],
  ["a host nobody vetted", "https://evil.example/x.png", 403],
];

for (const [name, url, status] of failures) {
  test(`${name} is refused with no-store`, async () => {
    const response = await GET(new Request(`http://timbre.test/api/art?u=${url}`));
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
}

test("an unreachable CDN is a 502 nothing remembers", async () => {
  upstream(() => {
    throw new TypeError("fetch failed");
  });
  const response = await ask(COVER);

  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

// `https://i.ytimg.com/robots.txt` against a production build returned 404 "Not an image." with
// no cache directive at all, while the branch immediately above it set `no-store`. 404 is one of
// the statuses RFC 9111 lets a shared cache hold on a heuristic when nothing says otherwise.
test("an allowlisted host answering with something that is not a raster is not cacheable", async () => {
  upstream(() => new Response("User-agent: *", { status: 200, headers: { "content-type": "text/plain" } }));
  const response = await ask(COVER);

  assert.equal(response.status, 404);
  assert.equal(await response.text(), "Not an image.");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("an oversized cover is refused with no-store", async () => {
  upstream(
    () =>
      new Response("x", {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(64 * 1024 * 1024) },
      }),
  );
  const response = await ask(COVER);

  assert.equal(response.status, 413);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

// archive.org answers a missing cover with a 302 to `/images/notfound.png`, which fails the path
// pin this proxy puts on that host. The walk stops and the route used to call that "Host not allowed" —
// blaming the reader for a URL whose host it had already allowed one line earlier.
test("a redirect this proxy will not follow is the upstream's doing, not the caller's", async () => {
  upstream(() => new Response(null, { status: 302, headers: { location: "/images/notfound.png" } }));
  const response = await ask("https://archive.org/services/img/no-such-identifier");

  assert.equal(response.status, 502);
  assert.equal(await response.text(), "Upstream redirected off the allowlist.");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("a cover that arrives is still served immutable", async () => {
  upstream(
    () => new Response("png bytes", { status: 200, headers: { "content-type": "image/png" } }),
  );
  const response = await ask(COVER);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await response.text(), "png bytes");
});
