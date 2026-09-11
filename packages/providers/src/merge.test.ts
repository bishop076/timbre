import assert from "node:assert/strict";
import { test } from "node:test";

import { mergeTracks } from "./merge.ts";
import type { SourceId, SourceTrack } from "./types.ts";

function track(overrides: Partial<SourceTrack> & { source: SourceId }): SourceTrack {
  return {
    sourceId: `${overrides.source}-1`,
    title: "Wonderwall",
    artists: ["Oasis"],
    album: null,
    durationMs: 259_000,
    isrc: null,
    url: null,
    artworkUrl: null,
    playback: overrides.source === "ytmusic" ? "queue" : "link",
    ...overrides,
  };
}

const sourcesOf = (song: { sources: SourceTrack[] }) => song.sources.map((source) => source.source);

const counts: [string, SourceTrack[], number][] = [
  ["an empty result set produces no songs", [], 0],
  [
    "different ISRCs never merge, however alike they look",
    [
      track({ source: "deezer", isrc: "GBAAW9500189", sourceId: "a" }),
      track({ source: "apple", isrc: "GBQCP2500095", sourceId: "b" }),
    ],
    2,
  ],
  [
    "a live take never merges into the studio version",
    [
      track({ source: "ytmusic" }),
      track({ source: "deezer", title: "Wonderwall (Live at Knebworth)" }),
    ],
    2,
  ],
  [
    "an acoustic version never merges into the original, whatever the brackets",
    [
      track({ source: "ytmusic" }),
      track({ source: "deezer", title: "Wonderwall (Acoustic)" }),
      track({ source: "apple", title: "Wonderwall - Acoustic Version" }),
    ],
    2,
  ],
  [
    "durations that disagree keep recordings apart",
    [track({ source: "ytmusic" }), track({ source: "deezer", durationMs: 320_000 })],
    2,
  ],
  [
    "a small duration difference is tolerated",
    [track({ source: "ytmusic" }), track({ source: "deezer", durationMs: 261_000 })],
    1,
  ],
  [
    "an unknown duration is not treated as a mismatch",
    [track({ source: "ytmusic" }), track({ source: "apple", durationMs: null })],
    1,
  ],
  [
    "a variant never merges into the original, even with no ISRC anywhere",
    [
      track({ source: "ytmusic", title: "Blinding Lights", durationMs: 200_000 }),
      track({ source: "audius", title: "Blinding Lights (Zaza Remix)", durationMs: 200_000 }),
    ],
    2,
  ],
  [
    "a different edit still stands apart, however the credits are written",
    [
      track({ source: "deezer", title: "This Was Your Song", artists: ["Lé Real"], durationMs: 93_000 }),
      track({
        source: "apple",
        title: "This Was Your Song",
        artists: ["Lé Real & Jordan Maxwell"],
        durationMs: 88_050,
      }),
    ],
    2,
  ],
  [
    "a track crediting nobody does not swallow every song of the same name",
    [
      track({ source: "ytmusic", title: "Halo", artists: [] }),
      track({ source: "deezer", title: "Halo", artists: ["Beyoncé"] }),
    ],
    2,
  ],
  [
    "a live take stays apart even when one side also names the guest",
    [
      track({ source: "deezer" }),
      track({ source: "apple", title: "Wonderwall (Live)", artists: ["Oasis & Noel Gallagher"] }),
    ],
    2,
  ],
];

for (const [name, input, expected] of counts) {
  test(name, () => assert.equal(mergeTracks(input).length, expected));
}

test("merges the same recording across sources, the playable one leading", () => {
  const songs = mergeTracks([
    track({ source: "apple" }),
    track({ source: "ytmusic" }),
    track({ source: "deezer" }),
  ]);
  assert.equal(songs.length, 1);
  assert.deepEqual(sourcesOf(songs[0]!), ["ytmusic", "apple", "deezer"]);
  assert.equal(songs[0]!.sources[0]!.playback, "queue");
});

test("an ISRC match is decisive even when the titles differ", () => {
  const songs = mergeTracks([
    track({ source: "ytmusic", isrc: "GBAAW9500189" }),
    track({ source: "deezer", isrc: "GBAAW9500189", title: "Wonderwall - Remastered" }),
  ]);
  assert.equal(songs.length, 1);
  assert.equal(songs[0]!.isrc, "GBAAW9500189");
});

test("one source contributes at most once per song", () => {
  const songs = mergeTracks([
    track({ source: "ytmusic", sourceId: "first" }),
    track({ source: "ytmusic", sourceId: "second" }),
  ]);
  assert.equal(songs.length, 1);
  assert.deepEqual(songs[0]!.sources.map((source) => source.sourceId), ["first"]);
});

test("song ids are unique even when two recordings share a dedupe key", () => {
  const songs = mergeTracks([
    track({ source: "ytmusic", sourceId: "a" }),
    track({ source: "ytmusic", sourceId: "b", durationMs: 400_000 }),
  ]);
  assert.equal(songs.length, 2);
  assert.notEqual(songs[0]!.id, songs[1]!.id);
});

test("a blank ISRC is not an id, and cannot collide", () => {
  const songs = mergeTracks(
    ["One", "Two", "Three"].map((title) =>
      track({ source: "audius", sourceId: title, title, isrc: "" }),
    ),
  );
  assert.equal(new Set(songs.map((song) => song.id)).size, 3);
  for (const song of songs) assert.ok(song.id.length > 0, "an id must never be empty");
});

test("display metadata is filled in from whichever source has it", () => {
  const songs = mergeTracks([
    track({ source: "ytmusic" }),
    track({ source: "deezer", album: "Morning Glory", artworkUrl: "https://art.example/x.jpg" }),
  ]);
  assert.equal(songs.length, 1);
  assert.equal(songs[0]!.album, "Morning Glory");
  assert.equal(songs[0]!.artworkUrl, "https://art.example/x.jpg");
});

test("input order is preserved so the primary source drives relevance", () => {
  const songs = mergeTracks([
    track({ source: "ytmusic", title: "Second Song", sourceId: "s2" }),
    track({ source: "ytmusic", title: "First Song", sourceId: "s1" }),
  ]);
  assert.deepEqual(
    songs.map((song) => song.title),
    ["Second Song", "First Song"],
  );
});

test("one catalogue naming the guest does not split the recording in two", () => {
  const songs = mergeTracks([
    track({
      source: "deezer",
      title: "This Was Your Song",
      artists: ["Lé Real"],
      durationMs: 93_000,
      isrc: "QM42K1730629",
    }),
    track({
      source: "apple",
      title: "This Was Your Song",
      artists: ["Lé Real & Jordan Maxwell"],
      durationMs: 92_004,
    }),
  ]);
  assert.equal(songs.length, 1);
  assert.deepEqual(sourcesOf(songs[0]!), ["deezer", "apple"]);
});

test("a preview clip survives the merge on the source that offered it", () => {
  const preview = "https://cdnt-preview.dzcdn.net/api/1/1/x.mp3";
  const songs = mergeTracks([
    track({ source: "ytmusic", previewUrl: null }),
    track({ source: "deezer", previewUrl: preview }),
  ]);
  assert.equal(songs.length, 1);
  assert.deepEqual(
    songs[0]!.sources.map((source) => source.previewUrl),
    [null, preview],
  );
});

test("a track carrying an ISRC joins the group that holds it, not the first title match", () => {
  const songs = mergeTracks([
    track({ source: "ytmusic", sourceId: "yt-long", durationMs: 189_000 }),
    track({ source: "ytmusic", sourceId: "yt-short", durationMs: 174_000 }),
    track({ source: "deezer", durationMs: 174_000, isrc: "GBK3W2000225" }),
    track({ source: "soundcloud", durationMs: 189_000, isrc: "GBK3W2000225" }),
  ]);
  assert.equal(songs.length, 2);
  assert.equal(new Set(songs.map((song) => song.id)).size, 2, "two songs must not share an id");
  const owner = songs.find((song) => song.isrc === "GBK3W2000225")!;
  assert.deepEqual(sourcesOf(owner).sort(), ["deezer", "soundcloud", "ytmusic"]);
});
