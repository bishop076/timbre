import assert from "node:assert/strict";
import { test } from "node:test";

import {
  activeProvider,
  artTrackIds,
  hasYouTube,
  isScrollKey,
  matchQuality,
  readAnswer,
  readScroll,
  retryDelayMs,
  scrollSettleMs,
} from "./lyrics-source.ts";

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

test("a 200 that is not this route's answer is a failure, not a song without lyrics", () => {
  // `response.json()` gives `null` for a captive portal's HTML or a truncated body, and a proxy
  // can answer 200 with JSON of its own. Both used to read as "no lyrics for this track".
  assert.deepEqual(readAnswer(200, null, null), { kind: "failed" });
  assert.deepEqual(readAnswer(200, null, "<html>Sign in to this network</html>"), { kind: "failed" });
  assert.deepEqual(readAnswer(200, null, {}), { kind: "failed" });
  assert.deepEqual(readAnswer(200, null, { error: "nope" }), { kind: "failed" });
  assert.deepEqual(readAnswer(200, null, []), { kind: "failed" });
  assert.deepEqual(readAnswer(200, null, { lyrics: "words" }), { kind: "failed" });
  assert.deepEqual(readAnswer(200, null, { lyrics: [] }), { kind: "failed" });
});

test("lyrics holding no words are none, not an empty page captioned as lyrics", () => {
  const empty = { instrumental: false, synced: null, plain: null, matchedTitle: "Creep" };
  assert.deepEqual(readAnswer(200, null, { lyrics: empty }), { kind: "none" });
  assert.deepEqual(readAnswer(200, null, { lyrics: { plain: "   " } }), { kind: "none" });
  // Instrumental is an answer about the song, so it stays found and keeps its own sentence.
  assert.deepEqual(readAnswer(200, null, { lyrics: { instrumental: true } }), {
    kind: "found",
    lyrics: { instrumental: true, synced: null, plain: null },
  });
});

test("timed lines that cannot drive the follow are dropped, and the rest put in order", () => {
  const answer = readAnswer(200, null, {
    lyrics: {
      instrumental: false,
      plain: "two\none",
      synced: [
        { at: 9, text: "two" },
        { at: "1", text: "string stamp" },
        { at: null, text: "no stamp at all" },
        { at: Number.NaN, text: "unparsed [mm:ss]" },
        { at: 2, text: "one" },
        { at: 5 },
        "nonsense",
        null,
      ],
    },
  });
  assert.deepEqual(answer, {
    kind: "found",
    lyrics: {
      instrumental: false,
      plain: "two\none",
      synced: [
        { at: 2, text: "one" },
        { at: 9, text: "two" },
      ],
    },
  });
});

test("a synced list with nothing usable left falls back to the plain words", () => {
  const answer = readAnswer(200, null, {
    lyrics: { instrumental: false, plain: "the words", synced: [{ at: Number.NaN, text: "x" }] },
  });
  assert.deepEqual(answer, {
    kind: "found",
    lyrics: { instrumental: false, plain: "the words", synced: null },
  });
});

test("the match is exact only when the title agrees and the credits share a name", () => {
  const asked = { title: "Creep", artist: "Radiohead" };
  assert.equal(matchQuality(asked, { matchedTitle: "Creep", matchedArtist: "Radiohead" }), "exact");
  // LRCLIB's search is the fallback and it answers with whatever contains the words asked for.
  assert.equal(
    matchQuality({ title: "Creep", artist: "Nirvana" }, { matchedTitle: "Negative Creep", matchedArtist: "Nirvana" }),
    "different",
  );
  assert.equal(matchQuality(asked, { matchedTitle: "Creep", matchedArtist: "Macy Gray" }), "cover");
});

test("noise in either title, and a featured artist on one side only, are not a mismatch", () => {
  assert.equal(
    matchQuality(
      { title: "Creep (Remastered 2009)", artist: "Radiohead" },
      { matchedTitle: "Creep", matchedArtist: "Radiohead" },
    ),
    "exact",
  );
  assert.equal(
    matchQuality(
      { title: "Sicko Mode", artist: "Travis Scott" },
      { matchedTitle: "SICKO MODE", matchedArtist: "Travis Scott, Drake" },
    ),
    "exact",
  );
});

test("a provider that names no match is unknown, so nothing is accused of being wrong", () => {
  // YouTube Music matches by video id and reports no track name back.
  assert.equal(matchQuality({ title: "Creep", artist: "Radiohead" }, {}), "unknown");
  assert.equal(matchQuality({ title: "", artist: "Radiohead" }, { matchedTitle: "Creep" }), "unknown");
  assert.equal(matchQuality({ title: "Creep", artist: "" }, { matchedTitle: "Creep", matchedArtist: "Radiohead" }), "unknown");
});

test("a scroll is the reader's once our own has had time to land", () => {
  assert.equal(scrollSettleMs("smooth") > scrollSettleMs("auto"), true, "reduced motion lands sooner");
  // Nothing of ours is in flight: whatever moved the box, the reader did.
  assert.deepEqual(readScroll(1_000, null, 700), { reader: true, scrolledAt: null });
  assert.deepEqual(readScroll(1_000, 900, 700), { reader: false, scrolledAt: 1_000 });
  assert.deepEqual(readScroll(1_000, 100, 700), { reader: true, scrolledAt: null });
});

test("a smooth scroll longer than the window is still ours, event after event", () => {
  // Chrome fires `scroll` every frame for as long as the glide lasts, and crossing a full panel
  // takes far longer than the window. Measured from the call that started it, the tail read as a
  // reader taking hold — so the follow restored itself and cancelled itself in the same second.
  let scrolledAt: number | null = 0;
  for (let frame = 16; frame <= 2_000; frame += 16) {
    const read = readScroll(frame, scrolledAt, 700);
    assert.equal(read.reader, false, `frame ${frame} of our own scroll`);
    scrolledAt = read.scrolledAt;
  }
  // And the moment it stops arriving, the box belongs to whoever moves it next.
  assert.deepEqual(readScroll(2_800, scrolledAt, 700), { reader: true, scrolledAt: null });
});

test("the keys that scroll the lyrics count as taking hold of them; the ones that act do not", () => {
  for (const key of ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]) {
    assert.equal(isScrollKey(key), true, key);
  }
  for (const key of ["Enter", " ", "Tab", "Escape", "ArrowLeft", "ArrowRight", "a"]) {
    assert.equal(isScrollKey(key), false, key);
  }
});
