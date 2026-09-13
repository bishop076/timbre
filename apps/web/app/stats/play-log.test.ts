import assert from "node:assert/strict";
import { test } from "node:test";

import { appendPlay, EMPTY_LOG, parsePlayLog, PLAY_LOG_LIMIT } from "./play-log.ts";

const CID = "baeaaaiqsecd464n7qxtqqo67upgngf2fcajvoo34d77qqipyxnu2vpqazrwom";

const song = (id: string, artworkUrl: string | null = null) => ({
  id,
  title: "Delilah",
  artists: ["Someone"],
  artworkUrl,
  videoId: null,
});

const logOf = (artworkUrl: string | null) => ({
  plays: [["audius:abc", 1_700_000_000_000]],
  songs: { "audius:abc": song("audius:abc", artworkUrl) },
});

test("a stored cover is held to the same rule as a playlist's", () => {
  const stale = `https://audius-creator-7.theblueprint.xyz/content/${CID}/480x480.jpg`;
  const parsed = parsePlayLog(logOf(stale));

  assert.equal(
    parsed.songs["audius:abc"]?.artworkUrl,
    `https://api.audius.co/content/${CID}/480x480.jpg`,
  );
});

test("a cover on a host the proxy never serves is dropped, and the play kept", () => {
  const parsed = parsePlayLog(logOf("https://evil.example/beacon.png"));

  assert.equal(parsed.plays.length, 1);
  assert.equal(parsed.songs["audius:abc"]?.title, "Delilah");
  assert.equal(parsed.songs["audius:abc"]?.artworkUrl, null);
});

test("a readable log still round-trips, and a broken one is empty", () => {
  const good = "https://i.scdn.co/image/abc";
  assert.equal(parsePlayLog(logOf(good)).songs["audius:abc"]?.artworkUrl, good);

  assert.deepEqual(parsePlayLog(null), EMPTY_LOG);
  assert.deepEqual(parsePlayLog({ plays: "no", songs: {} }), EMPTY_LOG);
  assert.deepEqual(parsePlayLog({ plays: [["missing", 1]], songs: {} }), EMPTY_LOG);
});

test("the log stays inside its limit, newest first", () => {
  let log = EMPTY_LOG;
  for (let index = 0; index < PLAY_LOG_LIMIT + 5; index += 1) {
    log = appendPlay(log, song(`s${index}`), index);
  }

  assert.equal(log.plays.length, PLAY_LOG_LIMIT);
  assert.equal(log.plays[0]?.[0], `s${PLAY_LOG_LIMIT + 4}`);
});
