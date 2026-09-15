import assert from "node:assert/strict";
import { test } from "node:test";

import { judgeSoundCloudStart, MOST_REPRIEVES } from "./soundcloud-stall.ts";

test("a widget that never answered is stalled, however long it is given", () => {
  // The case that hung a playlist: the iframe stopped answering `postMessage` after a track
  // change, so a guard that waited for `getPosition` waited for ever. Silence is the answer.
  assert.equal(judgeSoundCloudStart(null, 0), "stalled");
  assert.equal(judgeSoundCloudStart(null, MOST_REPRIEVES), "stalled");
});

test("a track that has moved is playing, whatever it says about being paused", () => {
  assert.equal(judgeSoundCloudStart({ position: 1200, paused: false }, 0), "playing");
  assert.equal(judgeSoundCloudStart({ position: 1200, paused: true }, 0), "playing");
});

test("sitting at zero and admitting it is a stall straight away", () => {
  assert.equal(judgeSoundCloudStart({ position: 0, paused: true }, 0), "stalled");
});

test("sitting at zero while claiming to play buys one more window, and only one", () => {
  // A slow stream really can be buffering, and pulling the track off SoundCloud for that would
  // be its own bug — but "playing" at 0:00 cannot go on for ever either.
  assert.equal(judgeSoundCloudStart({ position: 0, paused: false }, 0), "wait");
  assert.equal(judgeSoundCloudStart({ position: 0, paused: false }, MOST_REPRIEVES), "stalled");
});
