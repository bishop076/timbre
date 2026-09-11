import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatSpeed,
  offeredSpeeds,
  parseSpeed,
  speedSupport,
  speedToApply,
  SPEEDS,
} from "./playback-speed.ts";

const nothing = {
  activeSource: null,
  videoId: null,
  streamUrl: null,
  mixcloudKey: null,
  spotifyTrackId: null,
  subscription: null,
  youtubeRates: null,
} as const;

test("a stored speed is one of the menu's or normal", () => {
  assert.equal(parseSpeed("1.25"), 1.25);
  assert.equal(parseSpeed(2), 2);
  assert.equal(parseSpeed(null), 1);
  assert.equal(parseSpeed("fast"), 1);
  assert.equal(parseSpeed("3"), 1);
  assert.equal(parseSpeed("0.25"), 1);
});

test("the menu's speeds are intersected with what the player lists", () => {
  assert.deepEqual(offeredSpeeds([0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]), [...SPEEDS]);
  assert.deepEqual(offeredSpeeds([0.25, 0.5, 1, 1.5, 2]), [1, 1.5, 2]);
  assert.deepEqual(offeredSpeeds([1]), [1]);
  assert.deepEqual(offeredSpeeds([1.2500000001, 1]), [1, 1.25]);
});

test("an empty list is a player that has not said yet, not one that refuses", () => {
  assert.deepEqual(offeredSpeeds([]), [...SPEEDS]);
});

test("the preference is applied when offered, normal speed otherwise", () => {
  assert.equal(speedToApply(1.5, [0.5, 1, 1.5, 2]), 1.5);
  assert.equal(speedToApply(1.25, [0.5, 1, 1.5, 2]), 1);
  assert.equal(speedToApply(2, [1]), 1);
  assert.equal(speedToApply(0.75, []), 0.75);
});

test("speeds are written the way the menu shows them", () => {
  assert.equal(formatSpeed(1), "1×");
  assert.equal(formatSpeed(1.25), "1.25×");
  assert.equal(formatSpeed(0.75), "0.75×");
  assert.equal(formatSpeed(2), "2×");
});

test("the <audio> element takes every speed", () => {
  const support = speedSupport({ ...nothing, activeSource: "audius", streamUrl: "/api/stream/x" });
  assert.deepEqual(support, { supported: true, speeds: [...SPEEDS] });
});

test("the widgets say they cannot, naming themselves", () => {
  const soundcloud = speedSupport({ ...nothing, activeSource: "soundcloud" });
  assert.equal(soundcloud.supported, false);
  assert.match(!soundcloud.supported ? soundcloud.reason : "", /SoundCloud/);

  const mixcloud = speedSupport({ ...nothing, activeSource: "mixcloud", mixcloudKey: "/a/b/" });
  assert.match(!mixcloud.supported ? mixcloud.reason : "", /Mixcloud/);

  const spotify = speedSupport({ ...nothing, activeSource: "spotify", spotifyTrackId: "id" });
  assert.match(!spotify.supported ? spotify.reason : "", /Spotify/);

  const apple = speedSupport({ ...nothing, activeSource: "apple", subscription: "apple" });
  assert.match(!apple.supported ? apple.reason : "", /Apple Music/);
});

test("the player choice follows now-playing's order", () => {
  const support = speedSupport({ ...nothing, activeSource: "soundcloud", streamUrl: "/x" });
  assert.equal(support.supported, false);
});

test("YouTube offers what it reported for this video, and the full set until it has", () => {
  const before = speedSupport({ ...nothing, activeSource: "ytmusic", videoId: "abc" });
  assert.deepEqual(before, { supported: true, speeds: [...SPEEDS] });

  const reported = speedSupport({
    ...nothing,
    activeSource: "ytmusic",
    videoId: "abc",
    youtubeRates: { videoId: "abc", rates: [0.5, 1, 1.5, 2] },
  });
  assert.deepEqual(reported, { supported: true, speeds: [1, 1.5, 2] });
});

test("a report for another video is ignored", () => {
  const stale = speedSupport({
    ...nothing,
    activeSource: "ytmusic",
    videoId: "new",
    youtubeRates: { videoId: "old", rates: [1] },
  });
  assert.deepEqual(stale, { supported: true, speeds: [...SPEEDS] });
});

test("a video YouTube will not vary is refused, not offered a single speed", () => {
  const fixed = speedSupport({
    ...nothing,
    activeSource: "ytmusic",
    videoId: "abc",
    youtubeRates: { videoId: "abc", rates: [1] },
  });
  assert.equal(fixed.supported, false);
});

test("nothing playing has nothing to speed up", () => {
  assert.equal(speedSupport(nothing).supported, false);
});
