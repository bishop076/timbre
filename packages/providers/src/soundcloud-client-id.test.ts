import assert from "node:assert/strict";
import { test } from "node:test";

import { assetScripts, clientIdFrom, createClientIdResolver } from "./soundcloud-client-id.ts";

test("finds the asset bundles in the order the page loads them", () => {
  const html = `<script src="https://a-v2.sndcdn.com/assets/0-abc.js"></script>
    <script src="https://example.com/not-theirs.js"></script>
    <script src="https://a-v2.sndcdn.com/assets/9-zzz.js"></script>`;
  assert.deepEqual(assetScripts(html), [
    "https://a-v2.sndcdn.com/assets/0-abc.js",
    "https://a-v2.sndcdn.com/assets/9-zzz.js",
  ]);
});

test("ignores scripts served from anywhere else", () => {
  assert.deepEqual(assetScripts(`<script src="https://evil.example/assets/x.js"></script>`), []);
});

test("reads the client_id out of a minified bundle", () => {
  assert.equal(clientIdFrom(`a={client_id:"iZIs9mchVcX5lhVRyQGGAYlNPVldzAoX"}`), "iZIs9mchVcX5lhVRyQGGAYlNPVldzAoX");
  assert.equal(clientIdFrom(`t.client_id="abcdefghijklmnopqrstuvwxyz012345"`), "abcdefghijklmnopqrstuvwxyz012345");
});

test("does not mistake a short value for an id", () => {
  assert.equal(clientIdFrom(`{client_id:"short"}`), null);
  assert.equal(clientIdFrom(`no id here at all`), null);
});

const BUNDLES = `<script src="https://a-v2.sndcdn.com/assets/0-a.js"></script>
  <script src="https://a-v2.sndcdn.com/assets/9-z.js"></script>`;
const ID = "iZIs9mchVcX5lhVRyQGGAYlNPVldzAoX";

async function withFetch(
  stub: (url: string, init?: { signal?: AbortSignal }) => Promise<unknown>,
  body: () => Promise<void>,
): Promise<void> {
  const real = globalThis.fetch;
  globalThis.fetch = stub as typeof fetch;
  try {
    await body();
  } finally {
    globalThis.fetch = real;
  }
}

const ok = (text: string) => ({ ok: true, status: 200, text: async () => text });

test("a resolved id is cached, not re-crawled on the next search", async () => {
  let calls = 0;
  await withFetch(
    async (url) => {
      calls += 1;
      return ok(url === "https://soundcloud.com" ? BUNDLES : `client_id:"${ID}"`);
    },
    async () => {
      const resolve = createClientIdResolver("UA", 5_000);
      assert.equal(await resolve(), ID);
      assert.equal(await resolve(), ID);
      assert.equal(calls, 2);
    },
  );
});

test("a refused crawl is not retried by every later search", async () => {
  let calls = 0;
  await withFetch(
    async () => {
      calls += 1;
      return { ok: false, status: 403, text: async () => "" };
    },
    async () => {
      const resolve = createClientIdResolver("UA", 5_000);
      for (let i = 0; i < 5; i += 1) assert.equal(await resolve(), null);
      assert.equal(calls, 1, "one attempt, then the back-off holds");
    },
  );
});

test("a hung upstream is abandoned rather than killing the resolver for good", async () => {
  let calls = 0;
  await withFetch(
    (_url, init) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    },
    async () => {
      const resolve = createClientIdResolver("UA", 10);
      assert.equal(await resolve(), null);
      assert.equal(calls, 1);
      assert.equal(await resolve(), null);
      assert.equal(calls, 1);
    },
  );
});

test("the deadline leaves no timer behind once it has been beaten", async () => {
  await withFetch(
    async (url) => ok(url === "https://soundcloud.com" ? BUNDLES : `client_id:"${ID}"`),
    async () => {
      const before = process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
      const resolve = createClientIdResolver("UA", 30_000);
      assert.equal(await resolve(), ID);
      const after = process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
      assert.equal(after, before, "the 30s deadline must not outlive the call it guarded");
    },
  );
});

test("the homepage's own hydration blob is read, and no bundle is fetched", async () => {
  let calls = 0;
  await withFetch(
    async (url) => {
      calls += 1;
      assert.equal(url, "https://soundcloud.com", "no bundle should be fetched");
      return ok(
        `<html>${BUNDLES}<script>window.__sc_hydration = [{"hydratable":"apiClient","data":{"id":"${ID}","isExpiring":false}}]</script></html>`,
      );
    },
    async () => {
      const resolve = createClientIdResolver("UA", 5_000);
      assert.equal(await resolve(), ID);
      assert.equal(calls, 1);
    },
  );
});

test("a homepage without the blob still falls back to the bundles", async () => {
  let calls = 0;
  await withFetch(
    async (url) => {
      calls += 1;
      return ok(url === "https://soundcloud.com" ? BUNDLES : `client_id:"${ID}"`);
    },
    async () => {
      const resolve = createClientIdResolver("UA", 5_000);
      assert.equal(await resolve(), ID);
      assert.equal(calls, 2, "homepage, then the last bundle");
    },
  );
});
