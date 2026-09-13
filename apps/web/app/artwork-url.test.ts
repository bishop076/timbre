import assert from "node:assert/strict";
import { test } from "node:test";

import { cover, proxied, sized } from "./artwork-url.ts";

test("an allowlisted cover is routed through the proxy", () => {
  assert.equal(
    proxied("https://i.ytimg.com/vi/H5v3kku4y6Q/hqdefault.jpg"),
    "/api/art?u=https%3A%2F%2Fi.ytimg.com%2Fvi%2FH5v3kku4y6Q%2Fhqdefault.jpg",
  );
});

test("an unlisted host is dropped, not passed through", () => {
  // The whole point: handing the URL back would have the browser fetch the cover straight
  // from a host nobody vetted, which is what /api/art exists to stop.
  assert.equal(proxied("https://audius-creator-7.theblueprint.xyz/content/abc/480x480.jpg"), null);
  assert.equal(proxied("https://cn1.mainnet.audiusindex.org/content/abc/480x480.jpg"), null);
  assert.equal(proxied("https://evil.example/cover.jpg"), null);
});

test("a listed host on a path it does not serve is dropped too", () => {
  // api.audius.co is allowlisted for covers only; ALLOWED_PATHS pins the rest.
  assert.equal(proxied("https://api.audius.co/content/abc123/480x480.jpg")?.startsWith("/api/art"), true);
  assert.equal(proxied("https://api.audius.co/v1/tracks?query=x"), null);
});

test("anything that is not an https url is dropped", () => {
  assert.equal(proxied("http://i.ytimg.com/vi/x/hq.jpg"), null);
  assert.equal(proxied("data:image/png;base64,AAAA"), null);
  assert.equal(proxied("not a url at all"), null);
  assert.equal(proxied(""), null);
  assert.equal(proxied(null), null);
  assert.equal(proxied(undefined), null);
});

test("sized only rewrites a size it recognises, and never invents a host", () => {
  const deezer = "https://cdn-images.dzcdn.net/images/cover/abc/1000x1000-000000-80-0-0.jpg";
  assert.match(sized(deezer, 250) ?? "", /\/250x250-/);
  // Asking for more than the original has leaves it alone rather than upscaling.
  assert.equal(sized(deezer, 2000), deezer);
  assert.equal(sized("https://evil.example/x.jpg", 250), "https://evil.example/x.jpg");
});

test("cover sizes and then proxies, and still drops an unlisted host", () => {
  const deezer = "https://cdn-images.dzcdn.net/images/cover/abc/1000x1000-000000-80-0-0.jpg";
  const out = cover(deezer, 250);
  assert.equal(out?.startsWith("/api/art?u="), true);
  assert.equal(out?.includes("250x250"), true);
  assert.equal(cover("https://evil.example/x.jpg", 250), null);
});
