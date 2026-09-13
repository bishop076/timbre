import assert from "node:assert/strict";
import { test } from "node:test";

import { fromArtistSlug, toArtistSlug } from "./artist-slug.ts";

test("a slug round-trips back to a readable name", () => {
  assert.equal(fromArtistSlug(toArtistSlug("Tame Impala")), "tame impala");
  assert.equal(fromArtistSlug("tame-impala"), "tame impala");
  assert.equal(fromArtistSlug(toArtistSlug("AC/DC")), "ac dc");
});

test("a name with no latin letters still survives the round trip", () => {
  // `toArtistSlug` falls back to percent-encoding, and Next hands the segment back decoded.
  assert.equal(toArtistSlug("東京事変"), encodeURIComponent("東京事変"));
  assert.equal(fromArtistSlug("東京事変"), "東京事変");
});

test("a lone percent is a name, not a broken escape", () => {
  // /artist/100%25 reaches this already decoded, so `decodeURIComponent` sees `100%` and
  // used to throw URIError — out of `generateMetadata`, which is outside the error boundary.
  for (const slug of ["100%", "%", "%zz", "50%-off"]) {
    assert.doesNotThrow(() => fromArtistSlug(slug));
  }
  assert.equal(fromArtistSlug("100%"), "100%");
  assert.equal(fromArtistSlug("%E6%9D%B1"), "東");
});
