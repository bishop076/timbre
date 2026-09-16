import assert from "node:assert/strict";
import { test } from "node:test";

import { attemptKey, giveUpReason } from "./player-context.tsx";

const A = "https://soundcloud.com/label/song";
const B = "https://soundcloud.com/someone-else/song";

test("two SoundCloud copies of one song are two different attempts", () => {
  // The whole point of the rescue: another uploader's copy is worth trying after the first fails.
  assert.notEqual(attemptKey({ kind: "soundcloud", url: A }), attemptKey({ kind: "soundcloud", url: B }));
});

test("the copy that just failed is the same attempt, whatever found it again", () => {
  // `/api/search` returns this very track first, so the rescue was handed back the url the
  // ladder had given up on — and taking it left the track loading for ever.
  assert.equal(attemptKey({ kind: "soundcloud", url: A }), attemptKey({ kind: "soundcloud", url: A }));
});

test("a stream is identified by its host and its id, not by being a stream", () => {
  assert.equal(
    attemptKey({ kind: "progressive", source: "audius", sourceId: "jaKgV" }),
    "progressive:audius:jaKgV",
  );
  assert.notEqual(
    attemptKey({ kind: "progressive", source: "audius", sourceId: "jaKgV" }),
    attemptKey({ kind: "progressive", source: "archive", sourceId: "jaKgV" }),
  );
});

test("a 30-second preview is never the same attempt as the source it came from", () => {
  assert.notEqual(
    attemptKey({ kind: "preview", source: "deezer", url: "https://cdn/preview.mp3" }),
    attemptKey({ kind: "subscription", source: "deezer", id: "123" }),
  );
});

test("the id is what separates two tracks on one embed", () => {
  assert.notEqual(attemptKey({ kind: "spotify", id: "one" }), attemptKey({ kind: "spotify", id: "two" }));
  assert.notEqual(attemptKey({ kind: "ytmusic", id: "one" }), attemptKey({ kind: "mixcloud", id: "one" }));
});

test("giving up on a stream does not assert an absence nobody checked", () => {
  // Reached with `attempted` empty: a song carrying no YouTube source of its own, or — as
  // measured, with `/api/search` answering 500 — a search that never came back at all. The old
  // wording said "there's no copy on YouTube" in both.
  const said = giveUpReason(0, true, null);
  assert.doesNotMatch(said, /no copy on YouTube/);
  assert.match(said, /wouldn't stream/);
});

test("copies that were actually tried are still counted, and named as tried", () => {
  assert.match(giveUpReason(3, true, null), /3 YouTube copies refused/);
  assert.match(giveUpReason(1, false, null), /only copy on YouTube/);
});

test("a connection YouTube turned away outranks any count of copies", () => {
  // Counting uploads when the address was the problem blames the wrong thing.
  assert.match(giveUpReason(2, true, "refused"), /refused this connection/);
  assert.match(giveUpReason(2, true, "blocked"), /never loaded here/);
});
