import assert from "node:assert/strict";
import { test } from "node:test";

import { playedHandle } from "./played-handle.ts";
import type { Song, SourceTrack } from "../types";

function song(sources: SourceTrack[]): Song {
  return {
    id: "song",
    title: "I'm laughing, but I just might cry",
    artists: ["Jenny Macke Open Floor"],
    album: null,
    durationMs: null,
    isrc: null,
    artworkUrl: null,
    sources,
  };
}

const mixcloud: SourceTrack = {
  source: "mixcloud",
  sourceId: "/jennymackedance/im-laughing/",
  url: "https://www.mixcloud.com/jennymackedance/im-laughing/",
  playback: "queue",
};

test("the source that played is the one recorded, not the first one listed", () => {
  const found = playedHandle(
    song([{ source: "ytmusic", sourceId: "abc", url: null, playback: "queue" }, mixcloud]),
    "mixcloud",
    null,
  );
  assert.deepEqual(found, {
    source: "mixcloud",
    sourceId: "/jennymackedance/im-laughing/",
    url: "https://www.mixcloud.com/jennymackedance/im-laughing/",
  });
});

test("a song with no sources records the copy search found", () => {
  // A history row written before sources were stored comes back with nothing to play, so the
  // player searches. Recording nothing here left the row as broken as it arrived and every
  // replay paid for the same search again. Cannot be driven in the browser harness: headless
  // Chrome never starts the YouTube iframe, so `playing` never fires.
  assert.deepEqual(playedHandle(song([]), "ytmusic", "dQw4w9WgXcQ"), {
    source: "ytmusic",
    sourceId: "dQw4w9WgXcQ",
    url: "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
  });
});

test("nothing is recorded when there is no handle to record", () => {
  // Better a row that falls back to searching than one asserting a source it never played.
  assert.equal(playedHandle(song([]), "ytmusic", null), null);
  assert.equal(playedHandle(song([]), null, null), null);
});

test("a source that did not play is not substituted for one that did", () => {
  // Only YouTube gets the search fallback, because only YouTube is what `videoId` names.
  assert.equal(playedHandle(song([mixcloud]), "audius", null), null);
});
