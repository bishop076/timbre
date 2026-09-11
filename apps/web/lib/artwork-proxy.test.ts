import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";

import { allowed, capped, fetchAllowed, MAX_BYTES } from "./artwork-proxy.ts";

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
