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
  // Both spellings appear depending on how the bundle was minified.
  assert.equal(clientIdFrom(`a={client_id:"iZIs9mchVcX5lhVRyQGGAYlNPVldzAoX"}`), "iZIs9mchVcX5lhVRyQGGAYlNPVldzAoX");
  assert.equal(clientIdFrom(`t.client_id="abcdefghijklmnopqrstuvwxyz012345"`), "abcdefghijklmnopqrstuvwxyz012345");
});

test("does not mistake a short value for an id", () => {
  // A stray `client_id:"x"` in unrelated code must not be adopted and then fail every call.
  assert.equal(clientIdFrom(`{client_id:"short"}`), null);
  assert.equal(clientIdFrom(`no id here at all`), null);
});

// The resolver itself. Only the two parsers above were covered, and every fault worth
// having a test for lived in the caching and the deadline rather than the regexes.

const BUNDLES = `<script src="https://a-v2.sndcdn.com/assets/0-a.js"></script>
  <script src="https://a-v2.sndcdn.com/assets/9-z.js"></script>`;
const ID = "iZIs9mchVcX5lhVRyQGGAYlNPVldzAoX";

/** Swaps `fetch` for the run of one test and always puts it back. */
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
      // Homepage plus the last bundle, and nothing for the second call.
      assert.equal(calls, 2);
    },
  );
});

test("a refused crawl is not retried by every later search", async () => {
  // Regression: a datacentre IP being refused is the likeliest failure here, and without a
  // back-off each search started a fresh walk of soundcloud.com — asking the host that had
  // already said no, once per search, for as long as the instance ran.
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
  // Regression: `fetch` has no timeout, so one socket that accepted the connection and then
  // said nothing left `inFlight` pending for ever. It is only cleared when the promise
  // settles, so every later search joined the same dead crawl and abstained permanently.
  let calls = 0;
  await withFetch(
    (_url, init) => {
      calls += 1;
      // Honour the crawl budget the way a real `fetch` honours a signal.
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    },
    async () => {
      const resolve = createClientIdResolver("UA", 10);
      assert.equal(await resolve(), null);
      assert.equal(calls, 1);
      // The crawl is still running here — a second call joins it rather than piling on.
      assert.equal(await resolve(), null);
      assert.equal(calls, 1);
    },
  );
});

test("the deadline leaves no timer behind once it has been beaten", async () => {
  // `Promise.race` abandons the loser, it does not cancel it: one live timer per search on
  // a cold instance, each holding a scale-to-zero container awake after it had answered.
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
  // The id is the `id` of an `apiClient` hydratable, not a key called `client_id` — which is
  // why searching the page for the obvious name finds nothing and makes the bundles look
  // necessary. One request instead of two, and inside the deadline rather than past it.
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
  // It is undocumented and can move, so the walk stays.
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
