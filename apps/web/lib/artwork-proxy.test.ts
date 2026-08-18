import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";

import { allowed, capped, fetchAllowed, MAX_BYTES } from "./artwork-proxy.ts";

/*
 * A real server rather than a stubbed `fetch`: the thing under test is how the runtime
 * reports a redirect, and a stub would only assert what I already believed. Loopback only,
 * on an ephemeral port — nothing here reaches the network.
 */
const routes: Record<string, (response: http.ServerResponse) => void> = {
  "/image": (response) => {
    response.writeHead(200, { "content-type": "image/png" });
    response.end("png bytes");
  },
  "/offsite": (response) => {
    response.writeHead(302, { location: "https://evil.example/steal.png" });
    response.end();
  },
  "/relative": (response) => {
    response.writeHead(302, { location: "/image" });
    response.end();
  },
  "/no-location": (response) => {
    response.writeHead(302);
    response.end();
  },
  "/loop": (response) => {
    response.writeHead(302, { location: "/loop" });
    response.end();
  },
  "/not-modified": (response) => {
    response.writeHead(304);
    response.end();
  },
};

const server = http.createServer((request, response) => {
  const handler = routes[new URL(request.url ?? "/", "http://localhost").pathname];
  if (handler) return handler(response);
  response.writeHead(404);
  response.end();
});

const listening = new Promise<number>((resolve) => {
  server.listen(0, "127.0.0.1", () => {
    resolve((server.address() as { port: number }).port);
  });
});

after(() => server.close());

async function at(path: string) {
  return new URL(path, `http://127.0.0.1:${await listening}`);
}

/** The test server is plain http on loopback, so the real check would refuse every hop. */
const onLoopback = (url: URL) => url.hostname === "127.0.0.1";

test("the allowlist refuses anything that is not https", () => {
  assert.equal(allowed(new URL("https://i.ytimg.com/vi/x/hq.jpg")), true);
  assert.equal(allowed(new URL("http://i.ytimg.com/vi/x/hq.jpg")), false);
  assert.equal(allowed(new URL("https://evil.example/x.png")), false);
  // A lookalike host is not a substring match.
  assert.equal(allowed(new URL("https://i.ytimg.com.evil.example/x.png")), false);
});

// docs/SECURITY.md S-5. `redirect: "follow"` checked the allowlist once, then went
// wherever it was sent.

test("a redirect off the allowlist is refused rather than followed", async () => {
  const result = await fetchAllowed(await at("/offsite"), { isAllowed: onLoopback });
  assert.equal(result, null);
});

test("a redirect that stays on an allowed host is followed", async () => {
  const result = await fetchAllowed(await at("/relative"), { isAllowed: onLoopback });
  assert.equal(result?.status, 200);
  assert.equal(await result?.text(), "png bytes");
});

test("a redirect chain that will not end is abandoned", async () => {
  const result = await fetchAllowed(await at("/loop"), { isAllowed: onLoopback });
  assert.equal(result, null);
});

test("a redirect with no location is refused", async () => {
  const result = await fetchAllowed(await at("/no-location"), { isAllowed: onLoopback });
  assert.equal(result, null);
});

test("304 is not treated as a redirect", async () => {
  // It is in the 300s and carries no `location`; reading it as a hop would refuse a
  // response that is perfectly fine.
  const result = await fetchAllowed(await at("/not-modified"), { isAllowed: onLoopback });
  assert.equal(result?.status, 304);
});

test("a plain response is returned untouched", async () => {
  const result = await fetchAllowed(await at("/image"), { isAllowed: onLoopback });
  assert.equal(result?.status, 200);
  assert.equal(result?.headers.get("content-type"), "image/png");
});

// docs/EXPOSURE.md E-9. The cap used to be skipped whenever `content-length` looked sane,
// which left it in the hands of whoever answered.

test("a body past the cap errors even when nothing declared its size", async () => {
  const oversized = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_BYTES + 1));
      controller.close();
    },
  });

  await assert.rejects(
    () => new Response(capped(oversized, MAX_BYTES)).arrayBuffer(),
    /size limit/,
  );
});

test("a body within the cap passes through whole", async () => {
  const small = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(1024));
      controller.close();
    },
  });

  const body = await new Response(capped(small, MAX_BYTES)).arrayBuffer();
  assert.equal(body.byteLength, 1024);
});
