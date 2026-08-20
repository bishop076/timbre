import assert from "node:assert/strict";
import { test } from "node:test";

import { assetScripts, clientIdFrom } from "./soundcloud-client-id.ts";

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
