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

const ALL = { supported: true, speeds: [...SPEEDS] };

test("a stored speed is one of the menu's or normal", () => {
  const cases: [unknown, number][] = [["1.25", 1.25], [2, 2], [null, 1], ["fast", 1], ["3", 1], ["0.25", 1]];
  for (const [raw, speed] of cases) assert.equal(parseSpeed(raw), speed, String(raw));
});

test("the menu's speeds are intersected with what the player lists, all of them until it has", () => {
  assert.deepEqual(offeredSpeeds([0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]), [...SPEEDS]);
  assert.deepEqual(offeredSpeeds([0.25, 0.5, 1, 1.5, 2]), [1, 1.5, 2]);
  assert.deepEqual(offeredSpeeds([1]), [1]);
  assert.deepEqual(offeredSpeeds([1.2500000001, 1]), [1, 1.25]);
  assert.deepEqual(offeredSpeeds([]), [...SPEEDS]);
});

test("the preference is applied when offered, normal speed otherwise", () => {
  assert.equal(speedToApply(1.5, [0.5, 1, 1.5, 2]), 1.5);
  assert.equal(speedToApply(1.25, [0.5, 1, 1.5, 2]), 1);
  assert.equal(speedToApply(2, [1]), 1);
  assert.equal(speedToApply(0.75, []), 0.75);
});

test("speeds are written the way the menu shows them", () => {
  for (const [rate, text] of [[1, "1×"], [1.25, "1.25×"], [0.75, "0.75×"], [2, "2×"]] as const) {
    assert.equal(formatSpeed(rate), text);
  }
});

test("the <audio> element takes every speed", () => {
  assert.deepEqual(speedSupport({ ...nothing, activeSource: "audius", streamUrl: "/api/stream/x" }), ALL);
});

test("the widgets say they cannot, naming themselves, and win over a stream URL like now-playing", () => {
  const widgets = [
    [{ activeSource: "soundcloud", streamUrl: "/x" }, /SoundCloud/],
    [{ activeSource: "mixcloud", mixcloudKey: "/a/b/" }, /Mixcloud/],
    [{ activeSource: "spotify", spotifyTrackId: "id" }, /Spotify/],
    [{ activeSource: "apple", subscription: "apple" }, /Apple Music/],
  ] as const;
  for (const [playing, name] of widgets) {
    const support = speedSupport({ ...nothing, ...playing });
    assert.match(support.supported ? "" : support.reason, name);
  }
});

test("YouTube offers what it reported for this video, and the full set until it has", () => {
  const youtube = (youtubeRates: { videoId: string; rates: number[] } | null) =>
    speedSupport({ ...nothing, activeSource: "ytmusic", videoId: "abc", youtubeRates });

  assert.deepEqual(youtube(null), ALL);
  assert.deepEqual(youtube({ videoId: "abc", rates: [0.5, 1, 1.5, 2] }), { supported: true, speeds: [1, 1.5, 2] });
  assert.deepEqual(youtube({ videoId: "old", rates: [1] }), ALL, "a report for another video is ignored");
  assert.equal(youtube({ videoId: "abc", rates: [1] }).supported, false, "one speed is no choice");
});

test("nothing playing has nothing to speed up", () => {
  assert.equal(speedSupport(nothing).supported, false);
});
