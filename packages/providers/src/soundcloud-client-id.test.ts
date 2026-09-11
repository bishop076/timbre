import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { assetScripts, clientIdFrom, createClientIdResolver } from "./soundcloud-client-id.ts";

const BUNDLES = `<script src="https://a-v2.sndcdn.com/assets/0-a.js"></script>
  <script src="https://example.com/not-theirs.js"></script>
  <script src="https://evil.example/assets/x.js"></script>
  <script src="https://a-v2.sndcdn.com/assets/9-z.js"></script>`;
const ID = "iZIs9mchVcX5lhVRyQGGAYlNPVldzAoX";

test("finds only SoundCloud's own asset bundles, in the order the page loads them", () => {
  assert.deepEqual(assetScripts(BUNDLES), [
    "https://a-v2.sndcdn.com/assets/0-a.js",
    "https://a-v2.sndcdn.com/assets/9-z.js",
  ]);
});

test("reads the client_id out of a minified bundle, never a short value", () => {
  assert.equal(clientIdFrom(`a={client_id:"${ID}"}`), ID);
  assert.equal(clientIdFrom(`t.client_id="abcdefghijklmnopqrstuvwxyz012345"`), "abcdefghijklmnopqrstuvwxyz012345");
  assert.equal(clientIdFrom(`{client_id:"short"}`), null);
  assert.equal(clientIdFrom(`no id here at all`), null);
});

const ok = (text: string) => ({ ok: true, status: 200, text: async () => text });

function stubFetch(
  t: TestContext,
  respond: (url: string, init?: { signal?: AbortSignal }) => Promise<unknown>,
) {
  return t.mock.method(globalThis, "fetch", respond as typeof fetch).mock;
}

const homepageThenBundle = async (url: string) =>
  ok(url === "https://soundcloud.com" ? BUNDLES : `client_id:"${ID}"`);

test("without the blob it falls back to the last bundle, then caches the id", async (t) => {
  const fetches = stubFetch(t, homepageThenBundle);
  const resolve = createClientIdResolver("UA", 5_000);
  assert.equal(await resolve(), ID);
  assert.deepEqual(
    fetches.calls.map((call) => call.arguments[0]),
    ["https://soundcloud.com", "https://a-v2.sndcdn.com/assets/9-z.js"],
  );
  assert.equal(await resolve(), ID);
  assert.equal(fetches.callCount(), 2, "not re-crawled on the next search");
});

test("the homepage's own hydration blob is read, and no bundle is fetched", async (t) => {
  const blob = `{"hydratable":"apiClient","data":{"id":"${ID}","isExpiring":false}}`;
  const page = `<html>${BUNDLES}<script>window.__sc_hydration = [${blob}]</script></html>`;
  const fetches = stubFetch(t, async () => ok(page));
  assert.equal(await createClientIdResolver("UA", 5_000)(), ID);
  assert.equal(fetches.callCount(), 1);
});

test("a refused crawl is not retried by every later search", async (t) => {
  const fetches = stubFetch(t, async () => ({ ok: false, status: 403, text: async () => "" }));
  const resolve = createClientIdResolver("UA", 5_000);
  for (let i = 0; i < 5; i += 1) assert.equal(await resolve(), null);
  assert.equal(fetches.callCount(), 1, "one attempt, then the back-off holds");
});

test("a hung upstream is abandoned rather than killing the resolver for good", async (t) => {
  const fetches = stubFetch(
    t,
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );
  const resolve = createClientIdResolver("UA", 10);
  assert.equal(await resolve(), null);
  assert.equal(await resolve(), null);
  assert.equal(fetches.callCount(), 1);
});

test("the deadline leaves no timer behind once it has been beaten", async (t) => {
  stubFetch(t, homepageThenBundle);
  const timers = () => process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
  const before = timers();
  assert.equal(await createClientIdResolver("UA", 30_000)(), ID);
  assert.equal(timers(), before, "the 30s deadline must not outlive the call it guarded");
});
