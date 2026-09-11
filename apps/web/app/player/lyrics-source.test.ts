import assert from "node:assert/strict";
import { test } from "node:test";

import {
  activeProvider,
  artTrackIds,
  hasYouTube,
  readAnswer,
  retryDelayMs,
} from "./lyrics-source.ts";

// Every line of text here is an invented placeholder: real lyrics are licensed text.

const video = (sourceId: string) => ({ source: "ytmusic", sourceId, videoType: "MUSIC_VIDEO_TYPE_OMV" });
const artTrack = (sourceId: string) => ({ source: "ytmusic", sourceId, videoType: "MUSIC_VIDEO_TYPE_ATV" });
const untyped = (sourceId: string) => ({ source: "ytmusic", sourceId });
const audius = { source: "audius", sourceId: "x1" };

test("only art tracks are sent, since only they have lyrics pages", () => {
  assert.deepEqual(
    artTrackIds([video("vvvvvvvvvvv"), untyped("uuuuuuuuuuu"), artTrack("aaaaaaaaaaa")], "vvvvvvvvvvv"),
    ["aaaaaaaaaaa"],
  );
});

test("a playing art track leads the others", () => {
  assert.deepEqual(artTrackIds([artTrack("aaaaaaaaaaa"), artTrack("bbbbbbbbbbb")], "bbbbbbbbbbb"), [
    "bbbbbbbbbbb",
    "aaaaaaaaaaa",
  ]);
  assert.deepEqual(artTrackIds([artTrack("aaaaaaaaaaa"), artTrack("bbbbbbbbbbb")], null), [
    "aaaaaaaaaaa",
    "bbbbbbbbbbb",
  ]);
});

test("at most three art tracks are sent, each once", () => {
  const ids = artTrackIds(
    ["aaaaaaaaaaa", "aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc", "ddddddddddd"].map(artTrack),
    null,
  );
  assert.deepEqual(ids, ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"]);
});

test("a song with no known art track sends none, leaving the search to the sidecar", () => {
  assert.deepEqual(artTrackIds([video("vvvvvvvvvvv"), untyped("uuuuuuuuuuu")], "vvvvvvvvvvv"), []);
});

test("any YouTube copy, listed or playing, makes YouTube Music worth offering", () => {
  assert.equal(hasYouTube([video("vvvvvvvvvvv")], null), true);
  assert.equal(hasYouTube([audius], "zzzzzzzzzzz"), true, "a copy found after the listed ones failed");
  assert.equal(hasYouTube([audius], null), false);
  assert.equal(hasYouTube([], null), false);
});

test("LRCLIB is the default, and older stored preferences read as it", () => {
  assert.equal(activeProvider(undefined, true), "lrclib");
  assert.equal(activeProvider("lrclib", true), "lrclib");
  assert.equal(activeProvider("something-else", true), "lrclib");
});

test("YouTube Music is used only while the song has a YouTube copy", () => {
  assert.equal(activeProvider("ytmusic", true), "ytmusic");
  assert.equal(activeProvider("ytmusic", false), "lrclib");
});

test("lyrics found are read as found", () => {
  const lyrics = { instrumental: false, synced: [{ at: 1, text: "line one" }], plain: "line one" };
  assert.deepEqual(readAnswer(200, null, { lyrics }), { kind: "found", lyrics });
});

test("a null answer is no lyrics, not a failure", () => {
  assert.deepEqual(readAnswer(200, null, { lyrics: null }), { kind: "none" });
  assert.deepEqual(readAnswer(200, null, null), { kind: "none" });
});

test("LRCLIB's back-off is busy, with the wait it named", () => {
  assert.deepEqual(readAnswer(503, "42", { lyrics: null, busy: true }), {
    kind: "busy",
    retryAfterSeconds: 42,
  });
});

test("Timbre's own meter is busy too, not no lyrics", () => {
  assert.deepEqual(readAnswer(429, "12", { error: "Too many requests." }), {
    kind: "busy",
    retryAfterSeconds: 12,
  });
});

test("a busy answer without a readable wait assumes thirty seconds", () => {
  for (const header of [null, "", "soon", "0", "-4"]) {
    assert.deepEqual(readAnswer(503, header, null), { kind: "busy", retryAfterSeconds: 30 }, String(header));
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
