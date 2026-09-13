import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";

import {
  allowed,
  ALLOWED_HOSTS,
  ALLOWED_PATHS,
  capped,
  fetchAllowed,
  MAX_BYTES,
} from "./artwork-proxy.ts";

const routes: Record<string, [number, http.OutgoingHttpHeaders?, string?]> = {
  "/image": [200, { "content-type": "image/png" }, "png bytes"],
  "/offsite": [302, { location: "https://evil.example/steal.png" }],
  "/relative": [302, { location: "/image" }],
  "/no-location": [302],
  "/loop": [302, { location: "/loop" }],
  "/not-modified": [304],
};

const server = http.createServer((request, response) => {
  const { pathname } = new URL(request.url ?? "/", "http://localhost");
  const [status, headers, body] = routes[pathname] ?? [404];
  response.writeHead(status, headers);
  response.end(body);
});

const listening = new Promise<number>((resolve) => {
  server.listen(0, "127.0.0.1", () => {
    resolve((server.address() as { port: number }).port);
  });
});

after(() => server.close());

test("the allowlist refuses anything that is not https", () => {
  assert.equal(allowed(new URL("https://i.ytimg.com/vi/x/hq.jpg")), true);
  assert.equal(allowed(new URL("http://i.ytimg.com/vi/x/hq.jpg")), false);
  assert.equal(allowed(new URL("https://evil.example/x.png")), false);
  assert.equal(allowed(new URL("https://i.ytimg.com.evil.example/x.png")), false);
});

test("a host that also answers an API is pinned to its cover paths", () => {
  // The shapes archive.ts and song-shape.ts actually mint.
  assert.equal(allowed(new URL("https://archive.org/services/img/some-identifier")), true);
  assert.equal(allowed(new URL("https://api.audius.co/content/abc123/480x480.jpg")), true);

  // Anything else on those two hosts is an API call wearing an image's clothes.
  assert.equal(allowed(new URL("https://api.audius.co/v1/tracks?query=x")), false);
  assert.equal(allowed(new URL("https://api.audius.co/content/abc123/999x999.jpg")), false);
  assert.equal(allowed(new URL("https://archive.org/metadata/some-identifier")), false);
  assert.equal(allowed(new URL("https://archive.org/advancedsearch.php?q=x")), false);
  assert.equal(allowed(new URL("https://archive.org/services/img/a/../../metadata/b")), false);

  // A plain image CDN keeps taking any path.
  assert.equal(allowed(new URL("https://i.scdn.co/image/whatever")), true);
});

const cases: [string, string, number | null][] = [
  ["a plain response is returned untouched", "/image", 200],
  ["a redirect that stays on an allowed host is followed", "/relative", 200],
  ["304 is not treated as a redirect", "/not-modified", 304],
  ["a redirect off the allowlist is refused rather than followed", "/offsite", null],
  ["a redirect chain that will not end is abandoned", "/loop", null],
  ["a redirect with no location is refused", "/no-location", null],
];

for (const [name, path, status] of cases) {
  test(name, async () => {
    const url = new URL(path, `http://127.0.0.1:${await listening}`);
    const result = await fetchAllowed(url, { isAllowed: (hop) => hop.hostname === "127.0.0.1" });
    assert.equal(result?.status ?? null, status);
    if (status === 200) {
      assert.equal(result?.headers.get("content-type"), "image/png");
      assert.equal(await result?.text(), "png bytes");
    }
  });
}

test("a body past the cap errors even when nothing declared its size", async () => {
  const oversized = new Response(new Uint8Array(MAX_BYTES + 1)).body;
  await assert.rejects(() => new Response(capped(oversized, MAX_BYTES)).arrayBuffer(), /size limit/);
});

test("a body within the cap passes through whole", async () => {
  const small = new Response(new Uint8Array(1024)).body;
  const body = await new Response(capped(small, MAX_BYTES)).arrayBuffer();
  assert.equal(body.byteLength, 1024);
});

// Drives `fetchAllowed` with a stubbed network: the first request answers a redirect to
// `location`, the second (if it is taken) answers an image. Returns whether the hop was
// followed. `isAllowed` says no to everything, so only the offsite rule can permit it.
async function followsTo(target: URL, location: string): Promise<boolean> {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return calls === 1
      ? new Response(null, { status: 307, headers: { location } })
      : new Response("png bytes", { status: 200, headers: { "content-type": "image/png" } });
  }) as typeof fetch;
  try {
    return (await fetchAllowed(target, { isAllowed: () => false })) !== null;
  } finally {
    globalThis.fetch = real;
  }
}

const COVER = "/content/01K89BHY42CWNRSKG6VHTDYCB0/150x150.jpg";

test("an Audius cover follows its directory's hop off the allowlist", async () => {
  // api.audius.co is a directory, not a CDN: verified live, it answers 307 to a community
  // node such as v.monophonic.digital, a set that cannot be allowlisted.
  const audius = new URL(`https://api.audius.co${COVER}`);
  assert.equal(await followsTo(audius, `https://v.monophonic.digital${COVER}`), true);
  assert.equal(await followsTo(audius, `https://cn1.mainnet.audiusindex.org${COVER}`), true);
});

test("the hop is bounded by the path, the scheme, and the address", async () => {
  const audius = new URL(`https://api.audius.co${COVER}`);
  // Still has to be asking for the same cover.
  assert.equal(await followsTo(audius, "https://v.monophonic.digital/etc/passwd"), false);
  assert.equal(await followsTo(audius, "https://v.monophonic.digital/v1/users"), false);
  // And cannot be pointed at what only the server can reach.
  for (const host of ["127.0.0.1", "localhost", "192.168.1.10", "169.254.169.254", "172.16.0.5", "10.0.0.1"]) {
    assert.equal(await followsTo(audius, `https://${host}${COVER}`), false, host);
  }
  assert.equal(await followsTo(audius, `http://v.monophonic.digital${COVER}`), false);
});

test("no other host gets that latitude", async () => {
  assert.equal(
    await followsTo(new URL(`https://i.scdn.co${COVER}`), `https://v.monophonic.digital${COVER}`),
    false,
  );
  assert.equal(
    await followsTo(new URL("https://archive.org/services/img/x"), `https://v.monophonic.digital${COVER}`),
    false,
  );
});

// The hosts this app treats as *pages* — `song-shape.ts`'s SOURCE_HOSTS, plus the players.
// A page host on an image allowlist with no path bound is a lever for pointing the server at
// someone else's API, which is exactly what `music.youtube.com` was until it was dropped.
const PAGE_HOSTS = [
  "music.youtube.com",
  "www.youtube.com",
  "youtube.com",
  "m.youtube.com",
  "youtu.be",
  "soundcloud.com",
  "m.soundcloud.com",
  "audius.co",
  "api.audius.co",
  "www.mixcloud.com",
  "mixcloud.com",
  "archive.org",
  "open.spotify.com",
  "www.deezer.com",
  "deezer.com",
  "music.apple.com",
  "itunes.apple.com",
];

test("a page host is never relayed unbounded", () => {
  assert.equal(allowed(new URL("https://music.youtube.com/anything")), false);

  for (const host of PAGE_HOSTS) {
    if (!ALLOWED_HOSTS.has(host)) continue;
    assert.ok(
      host in ALLOWED_PATHS,
      `${host} serves pages as well as images, so it needs a path pattern`,
    );
  }
});
