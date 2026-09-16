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

test("the walk reaches every Audius host and then stops", () => {
  // `progressive-audio-player.tsx` asked this of the url the song shipped with rather than of
  // the one it was trying, so it only ever took the first of these steps and hosts three and
  // four were unreachable. The chain has to be walked from wherever the attempt currently is.
  const visited = [streamUrlFor("audius", "jaKgV")];
  for (let next = nextStreamHost(visited[0]!); next; next = nextStreamHost(next)) visited.push(next);
  assert.deepEqual(
    visited.map((url) => new URL(url).host),
    [
      "api.audius.co",
      "discoveryprovider.audius.co",
      "discoveryprovider2.audius.co",
      "discoveryprovider3.audius.co",
    ],
  );
});
