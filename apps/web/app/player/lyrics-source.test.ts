import assert from "node:assert/strict";
import { test } from "node:test";

import { activeProvider, artTrackIds, hasYouTube, readAnswer, retryDelayMs } from "./lyrics-source.ts";

const video = { source: "ytmusic", sourceId: "vvvvvvvvvvv", videoType: "MUSIC_VIDEO_TYPE_OMV" };
const artTrack = (sourceId: string) => ({ source: "ytmusic", sourceId, videoType: "MUSIC_VIDEO_TYPE_ATV" });
const audius = { source: "audius", sourceId: "x1" };

test("only art tracks are sent, since only they have lyrics pages; none known sends none", () => {
  const untyped = { source: "ytmusic", sourceId: "uuuuuuuuuuu" };
  assert.deepEqual(artTrackIds([video, untyped, artTrack("aaaaaaaaaaa")], "vvvvvvvvvvv"), ["aaaaaaaaaaa"]);
  assert.deepEqual(artTrackIds([video, untyped], "vvvvvvvvvvv"), []);
});

test("a playing art track leads the others", () => {
  const both = [artTrack("aaaaaaaaaaa"), artTrack("bbbbbbbbbbb")];
  assert.deepEqual(artTrackIds(both, "bbbbbbbbbbb"), ["bbbbbbbbbbb", "aaaaaaaaaaa"]);
  assert.deepEqual(artTrackIds(both, null), ["aaaaaaaaaaa", "bbbbbbbbbbb"]);
});

test("at most three art tracks are sent, each once", () => {
  const ids = artTrackIds(
    ["aaaaaaaaaaa", "aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc", "ddddddddddd"].map(artTrack),
    null,
  );
  assert.deepEqual(ids, ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"]);
});

test("any YouTube copy, listed or playing, makes YouTube Music worth offering", () => {
  assert.equal(hasYouTube([video], null), true);
  assert.equal(hasYouTube([audius], "zzzzzzzzzzz"), true, "a copy found after the listed ones failed");
  assert.equal(hasYouTube([audius], null), false);
  assert.equal(hasYouTube([], null), false);
});

test("LRCLIB is the default; YouTube Music is used only while the song has a YouTube copy", () => {
  assert.equal(activeProvider(undefined, true), "lrclib");
  assert.equal(activeProvider("lrclib", true), "lrclib");
  assert.equal(activeProvider("something-else", true), "lrclib");
  assert.equal(activeProvider("ytmusic", true), "ytmusic");
  assert.equal(activeProvider("ytmusic", false), "lrclib");
});

test("lyrics found are read as found, and a null answer as none rather than a failure", () => {
  const lyrics = { instrumental: false, synced: [{ at: 1, text: "line one" }], plain: "line one" };
  assert.deepEqual(readAnswer(200, null, { lyrics }), { kind: "found", lyrics });
  assert.deepEqual(readAnswer(200, null, { lyrics: null }), { kind: "none" });
  assert.deepEqual(readAnswer(200, null, null), { kind: "none" });
});

test("a back-off, LRCLIB's or Timbre's own meter, is busy for the wait named, else thirty seconds", () => {
  const busy = (retryAfterSeconds: number) => ({ kind: "busy", retryAfterSeconds });
  assert.deepEqual(readAnswer(503, "42", { lyrics: null, busy: true }), busy(42));
  assert.deepEqual(readAnswer(429, "12", { error: "Too many requests." }), busy(12));
  for (const header of [null, "", "soon", "0", "-4"]) {
    assert.deepEqual(readAnswer(503, header, null), busy(30), String(header));
  }
});

test("any other failure is a failure, distinct from no lyrics", () => {
  assert.deepEqual(readAnswer(502, null, { lyrics: null }), { kind: "failed" });
  assert.deepEqual(readAnswer(500, null, null), { kind: "failed" });
  assert.deepEqual(readAnswer(400, null, { error: "bad" }), { kind: "failed" });
});

test("the retry waits what the server asked, within five seconds and five minutes", () => {
  assert.equal(retryDelayMs(42), 42_000);
  assert.equal(retryDelayMs(1), 5_000);
  assert.equal(retryDelayMs(600), 300_000);
});
