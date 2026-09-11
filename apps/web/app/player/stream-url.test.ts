import assert from "node:assert/strict";
import { test } from "node:test";

import { nextStreamHost, streamUrlFor } from "./stream-url.ts";

test("an Audius stream starts on the primary host and keeps the play-count override", () => {
  assert.equal(
    streamUrlFor("audius", "jaKgV"),
    "https://api.audius.co/v1/tracks/jaKgV/stream?skip_play_count=false",
  );
});

test("the fallback is the same stream, path and query intact, on the next host", () => {
  // The query is the part that must survive: dropping `skip_play_count=false` on the retry
  // would play the song and credit nobody for it.
  const first = streamUrlFor("audius", "jaKgV");
  const second = nextStreamHost(first);
  assert.equal(second, "https://discoveryprovider.audius.co/v1/tracks/jaKgV/stream?skip_play_count=false");
  assert.equal(
    nextStreamHost(second!),
    "https://discoveryprovider2.audius.co/v1/tracks/jaKgV/stream?skip_play_count=false",
  );
});

test("the last host, and a source with one host, have nowhere to go", () => {
  assert.equal(
    nextStreamHost("https://discoveryprovider3.audius.co/v1/tracks/jaKgV/stream?skip_play_count=false"),
    null,
  );
  assert.equal(nextStreamHost(streamUrlFor("archive", "some-show/track01.mp3")), null);
});
