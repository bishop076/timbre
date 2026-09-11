import assert from "node:assert/strict";
import { test } from "node:test";

import { usableArtwork, usableSongs } from "./song-shape.ts";

const GOOD = {
  id: "yt:abc",
  title: "Wonderwall",
  artists: ["Oasis"],
  album: "(What's the Story) Morning Glory?",
  durationMs: 258_000,
  isrc: "GBAAA9500123",
  artworkUrl: "https://i.ytimg.com/vi/abc/hqdefault.jpg",
  sources: [
    { source: "ytmusic", sourceId: "abc", url: "https://music.youtube.com/watch?v=abc", playback: "queue" },
    {
      source: "deezer",
      sourceId: "1",
      url: "https://www.deezer.com/track/1",
      playback: "link",
      previewUrl: "https://cdnt-preview.dzcdn.net/api/1/1/x.mp3",
    },
  ],
};

test("a song Timbre produced comes back unchanged", () => {
  assert.deepEqual(usableSongs([GOOD]), [GOOD]);
});

test("records that are not songs are dropped", () => {
  const songs = usableSongs([null, 1, "x", { id: "a" }, { ...GOOD, id: 5 }, { ...GOOD, sources: null }]);
  assert.equal(songs.length, 0);
});

test("wrongly typed elements are repaired, not trusted", () => {
  const [song] = usableSongs([
    { ...GOOD, artists: [1, "Oasis", null], artworkUrl: 1, durationMs: "long", album: {}, isrc: 7 },
  ]);
  assert.deepEqual(song?.artists, ["Oasis"]);
  assert.equal(song?.artworkUrl, null);
  assert.equal(song?.durationMs, null);
  assert.equal(song?.album, null);
  assert.equal(song?.isrc, null);
});

test("sources that are not sources are dropped, and a bad playback reads as a link", () => {
  const [song] = usableSongs([
    { ...GOOD, sources: [null, { source: 1 }, { source: "audius", sourceId: "9", url: null, playback: "hack" }] },
  ]);
  assert.deepEqual(song?.sources, [{ source: "audius", sourceId: "9", url: null, playback: "link" }]);
});

test("a link that does not belong to its source is dropped", () => {
  const [song] = usableSongs([
    {
      ...GOOD,
      sources: [
        { source: "spotify", sourceId: "x", url: "https://accounts-spotify.example/login", playback: "manual" },
        { source: "soundcloud", sourceId: "y", url: "https://soundcloud.com/flume/never-be-like-you", playback: "queue" },
        { source: "ytmusic", sourceId: "z", url: "javascript:alert(1)", playback: "queue" },
      ],
    },
  ]);
  assert.equal(song?.sources[0]?.url, null);
  assert.equal(song?.sources[1]?.url, "https://soundcloud.com/flume/never-be-like-you");
  assert.equal(song?.sources[2]?.url, null);
});

test("a preview from anywhere but a catalogue is not kept", () => {
  const [song] = usableSongs([
    {
      ...GOOD,
      sources: [{ source: "deezer", sourceId: "1", url: null, playback: "link", previewUrl: "https://evil.example/x.mp3" }],
    },
  ]);
  assert.equal(song?.sources[0]?.previewUrl, undefined);
});

test("covers must come from a host the proxy serves, or are fetched from Audius itself", () => {
  assert.equal(usableArtwork("https://i.ytimg.com/vi/a/hq.jpg"), "https://i.ytimg.com/vi/a/hq.jpg");
  const deezer = "https://cdn-images.dzcdn.net/images/cover/h/500x500-000000-80-0-0.jpg";
  assert.equal(usableArtwork(deezer), deezer);
  assert.equal(
    usableArtwork("https://audius-content-10.figment.io/content/01JVSGMQ32Z7MX262JJZVAK0NZ/480x480.jpg"),
    "https://api.audius.co/content/01JVSGMQ32Z7MX262JJZVAK0NZ/480x480.jpg",
  );
  assert.equal(usableArtwork("https://attacker.example/beacon.png"), null);
  assert.equal(usableArtwork("http://i.ytimg.com/vi/a/hq.jpg"), null);
  assert.equal(usableArtwork("data:image/png;base64,AAAA"), null);
  assert.equal(usableArtwork(null), null);
});

test("an Audius-shaped cover on any other host never reaches that host", () => {
  const [song] = usableSongs([
    {
      ...GOOD,
      artworkUrl: "https://attacker.example/content/x1/480x480.jpg",
      artworkFallbacks: ["https://attacker.example/content/x1/480x480.jpg", "https://tracker.example/content/x1/480x480.jpg"],
    },
  ]);
  assert.equal(song?.artworkUrl, "https://api.audius.co/content/x1/480x480.jpg");
  assert.equal(song?.artworkFallbacks, undefined);
});

test("the play context survives only in its one valid shape", () => {
  const artist = { kind: "artist", name: "Oasis", imageUrl: "https://attacker.example/x.png" };
  const [kept, dropped] = usableSongs([
    { ...GOOD, from: artist },
    { ...GOOD, id: "b", from: { kind: "album", name: "x" } },
  ]);
  assert.deepEqual(kept?.from, { kind: "artist", name: "Oasis", imageUrl: null });
  assert.equal(dropped?.from, undefined);
});
