import assert from "node:assert/strict";
import { test } from "node:test";

import { collectionOrigin, samePlace, type QueueOrigin } from "./queue-origin.ts";

test("a collection is a place a queue can have come from", () => {
  // `kind` was "playlist" | "album", so a chart, a station or a Spotify collection could not
  // name itself as the origin at all — and the collection page's Play button never became
  // Pause, however long its own tracks had been playing.
  const chart: QueueOrigin = collectionOrigin("genre", "132");

  assert.equal(samePlace(chart, collectionOrigin("genre", "132")), true);
  assert.equal(samePlace(null, chart), false);
});

test("an id is only unique inside its kind", () => {
  // A genre and a station both numbered 132 are two different pages.
  assert.equal(samePlace(collectionOrigin("genre", "132"), collectionOrigin("radio", "132")), false);

  // And a collection whose id happens to read like a playlist's is still not that playlist.
  assert.equal(samePlace(collectionOrigin("genre", "132"), { kind: "playlist", id: "genre:132" }), false);
});

test("a page with no origin is never the one playing", () => {
  assert.equal(samePlace(collectionOrigin("genre", "132"), undefined), false);
  assert.equal(samePlace(null, undefined), false);
});
