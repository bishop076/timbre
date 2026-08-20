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

test("merges the same recording across sources into one song", () => {
  const songs = mergeTracks([
    track({ source: "ytmusic" }),
    track({ source: "deezer" }),
    track({ source: "apple" }),
  ]);

  assert.equal(songs.length, 1);
  assert.deepEqual(
    songs[0]!.sources.map((source) => source.source),
    ["ytmusic", "deezer", "apple"],
  );
});

test("an ISRC match is decisive even when the titles differ", () => {
  // Services title the same recording differently all the time.
  const songs = mergeTracks([
    track({ source: "ytmusic", isrc: "GBAAW9500189", title: "Wonderwall" }),
    track({ source: "deezer", isrc: "GBAAW9500189", title: "Wonderwall - Remastered" }),
  ]);

  assert.equal(songs.length, 1);
  assert.equal(songs[0]!.isrc, "GBAAW9500189");
});

test("different ISRCs never merge, however alike they look", () => {
  const songs = mergeTracks([
    track({ source: "deezer", isrc: "GBAAW9500189", sourceId: "a" }),
    track({ source: "apple", isrc: "GBQCP2500095", sourceId: "b" }),
  ]);

  assert.equal(songs.length, 2, "two ISRCs are two recordings");
});

test("a live take never merges into the studio version", () => {
  // The failure this whole module exists to prevent: queue one song, hear
  // another.
  const songs = mergeTracks([
    track({ source: "ytmusic", title: "Wonderwall" }),
    track({ source: "deezer", title: "Wonderwall (Live at Knebworth)" }),
  ]);

  assert.equal(songs.length, 2);
});

test("durations that disagree keep recordings apart", () => {
  const songs = mergeTracks([
    track({ source: "ytmusic", durationMs: 259_000 }),
    track({ source: "deezer", durationMs: 320_000 }),
  ]);

  assert.equal(songs.length, 2, "a minute apart is a different recording");
});

test("a small duration difference is tolerated", () => {
  const songs = mergeTracks([
    track({ source: "ytmusic", durationMs: 259_000 }),
    track({ source: "deezer", durationMs: 261_000 }),
  ]);

  assert.equal(songs.length, 1, "sources routinely disagree by a second or two");
});

test("an unknown duration is not treated as a mismatch", () => {
  // Apple's chart feed carries no duration at all.
  const songs = mergeTracks([
    track({ source: "ytmusic", durationMs: 259_000 }),
    track({ source: "apple", durationMs: null }),
  ]);

  assert.equal(songs.length, 1);
});

test("sources are ordered so the playable one leads", () => {
  const songs = mergeTracks([
    track({ source: "apple" }),
    track({ source: "deezer" }),
    track({ source: "ytmusic" }),
  ]);

  assert.equal(songs[0]!.sources[0]!.source, "ytmusic");
  assert.equal(songs[0]!.sources[0]!.playback, "queue");
});

test("one source contributes at most once per song", () => {
  // Search returns several near-identical uploads; the first is the relevant one.
  const songs = mergeTracks([
    track({ source: "ytmusic", sourceId: "first" }),
    track({ source: "ytmusic", sourceId: "second" }),
  ]);

  assert.equal(songs.length, 1);
  assert.equal(songs[0]!.sources.length, 1);
  assert.equal(songs[0]!.sources[0]!.sourceId, "first");
});

test("song ids are unique even when two recordings share a dedupe key", () => {
  // Regression: identical titles separated only by duration collided as ids,
  // which broke React keys and any lookup.
  const songs = mergeTracks([
    track({ source: "ytmusic", sourceId: "a", durationMs: 259_000 }),
    track({ source: "ytmusic", sourceId: "b", durationMs: 400_000 }),
  ]);

  assert.equal(songs.length, 2);
  assert.notEqual(songs[0]!.id, songs[1]!.id);
});

test("a blank ISRC is not an id, and cannot collide", () => {
  // Regression: `group.isrc ?? …` falls back only on null, so a provider that sends
  // an empty string rather than omitting the field passed one straight through — and
  // every song without an ISRC then shared the same empty id. Audius does exactly this;
  // three songs in one search reached React with the same key.
  const songs = mergeTracks([
    track({ source: "audius", sourceId: "a", title: "One", isrc: "" }),
    track({ source: "audius", sourceId: "b", title: "Two", isrc: "" }),
    track({ source: "audius", sourceId: "c", title: "Three", isrc: "" }),
  ]);

  assert.equal(songs.length, 3);
  assert.equal(new Set(songs.map((song) => song.id)).size, 3);
  for (const song of songs) assert.ok(song.id.length > 0, "an id must never be empty");
});

test("a variant never merges into the original, even with no ISRC anywhere", () => {
  // The rule the whole Audius integration rests on: it carries no usable ISRC and its
  // titles are *all* variants, so this is the only thing keeping a remix from being
  // swallowed by the song it remixes. OmniSource — a shipped multi-source plugin —
  // strips "remix" as noise and collapses exactly this pair.
  const songs = mergeTracks([
    track({ source: "ytmusic", sourceId: "orig", title: "Blinding Lights", durationMs: 200_000 }),
    track({ source: "audius", sourceId: "rmx", title: "Blinding Lights (Zaza Remix)", durationMs: 200_000 }),
  ]);

  assert.equal(songs.length, 2, "a remix must not be absorbed by the original");
});

test("display metadata is filled in from whichever source has it", () => {
  const songs = mergeTracks([
    track({ source: "ytmusic", album: null, artworkUrl: null }),
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

test("an empty result set produces no songs", () => {
  assert.deepEqual(mergeTracks([]), []);
});

test("one catalogue naming the guest does not split the recording in two", () => {
  // Reported as the same song listed three times on an artist page. Deezer billed it to the
  // artist alone and Apple to "artist & guest", so the two never shared a key.
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
  assert.deepEqual(
    songs[0]!.sources.map((source) => source.source),
    ["deezer", "apple"],
  );
});

test("a different edit still stands apart, however the credits are written", () => {
  // The third of those three rows: same title, same artist, five seconds shorter. Duration is
  // what keeps the relaxed credit test honest, so this one must not be swept in.
  const songs = mergeTracks([
    track({ source: "deezer", title: "This Was Your Song", artists: ["Lé Real"], durationMs: 93_000 }),
    track({
      source: "apple",
      title: "This Was Your Song",
      artists: ["Lé Real & Jordan Maxwell"],
      durationMs: 88_050,
    }),
  ]);

  assert.equal(songs.length, 2);
});

test("a track crediting nobody does not swallow every song of the same name", () => {
  const songs = mergeTracks([
    track({ source: "ytmusic", title: "Halo", artists: [] }),
    track({ source: "deezer", title: "Halo", artists: ["Beyoncé"] }),
  ]);

  assert.equal(songs.length, 2);
});

test("a live take stays apart even when one side also names the guest", () => {
  // Containment must not reach across a variant marker: that is the failure this whole file
  // exists to prevent.
  const songs = mergeTracks([
    track({ source: "deezer", title: "Wonderwall", artists: ["Oasis"] }),
    track({ source: "apple", title: "Wonderwall (Live)", artists: ["Oasis & Noel Gallagher"] }),
  ]);

  assert.equal(songs.length, 2);
});

test("a preview clip survives the merge on the source that offered it", () => {
  // Plumbing, and it has already failed once silently: the field is read in the browser but
  // set in a workspace package, so nothing in between complains when it stops being carried.
  const songs = mergeTracks([
    track({ source: "ytmusic", previewUrl: null }),
    track({ source: "deezer", previewUrl: "https://cdnt-preview.dzcdn.net/api/1/1/x.mp3" }),
  ]);

  assert.equal(songs.length, 1);
  assert.equal(
    songs[0]!.sources.find((source) => source.source === "deezer")?.previewUrl,
    "https://cdnt-preview.dzcdn.net/api/1/1/x.mp3",
  );
  assert.equal(songs[0]!.sources.find((source) => source.source === "ytmusic")?.previewUrl, null);
});
