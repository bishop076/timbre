import assert from "node:assert/strict";
import { test } from "node:test";

import { recommend, scoreCandidates } from "./recommend.ts";
import type { RankedList, SourceId, SourceTrack } from "./types.ts";

function track(title: string, artist: string, overrides: Partial<SourceTrack> = {}): SourceTrack {
  const source: SourceId = overrides.source ?? "ytmusic";
  return {
    source,
    sourceId: `${source}-${title}`.toLowerCase().replaceAll(" ", "-"),
    title,
    artists: [artist],
    album: null,
    durationMs: 200_000,
    isrc: null,
    url: null,
    artworkUrl: null,
    playback: source === "ytmusic" ? "queue" : "link",
    ...overrides,
  };
}

function list(name: string, tracks: SourceTrack[]): RankedList {
  return { list: name, tracks };
}

function titles(songs: { title: string }[]): string[] {
  return songs.map((song) => song.title);
}

test("a song two lists agree on beats a song only one list ranked first", () => {
  const lists = [
    list("a", [track("Solo", "Alpha"), track("Agreed", "Beta")]),
    list("b", [track("Other", "Gamma"), track("Agreed", "Beta")]),
  ];
  assert.equal(recommend(lists, { limit: 5 })[0]!.title, "Agreed");
});

test("three lists agreeing beats two", () => {
  const scored = scoreCandidates([
    list("a", [track("Twice", "Alpha"), track("Thrice", "Beta")]),
    list("b", [track("Twice", "Alpha"), track("Thrice", "Beta")]),
    list("c", [track("Filler", "Gamma"), track("Thrice", "Beta")]),
  ]);
  const thrice = scored.find((entry) => entry.song.title === "Thrice")!;
  const twice = scored.find((entry) => entry.song.title === "Twice")!;

  assert.equal(thrice.lists, 3);
  assert.equal(twice.lists, 2);
  assert.ok(thrice.score > twice.score);
});

test("cross-source agreement survives the merge into one song", () => {
  const scored = scoreCandidates([
    list("yt", [track("Shared", "Alpha", { source: "ytmusic" })]),
    list("dz", [track("Shared", "Alpha", { source: "deezer" })]),
  ]);
  assert.equal(scored.length, 1);
  assert.equal(scored[0]!.lists, 2);
  assert.deepEqual(
    scored[0]!.song.sources.map((source) => source.source),
    ["ytmusic", "deezer"],
  );
});

test("an art track is demoted below an official video that ranked equally", () => {
  const art = track("Art", "Alpha", { videoType: "MUSIC_VIDEO_TYPE_ATV" });
  const official = track("Official", "Beta", { videoType: "MUSIC_VIDEO_TYPE_OMV" });
  const lists = [list("a", [art, official]), list("b", [official, art])];
  assert.equal(recommend(lists, { limit: 2 })[0]!.title, "Official");
});

function scoreOfKind(videoType: string | null): number {
  const lists = [list(`only-${videoType}`, [track("Same", "Alpha", { videoType })])];
  return scoreCandidates(lists)[0]!.score;
}

test("an official artist-channel upload scores with official videos, above re-uploads", () => {
  const official = scoreOfKind("MUSIC_VIDEO_TYPE_OFFICIAL_SOURCE_MUSIC");
  assert.equal(official, scoreOfKind("MUSIC_VIDEO_TYPE_OMV"));
  assert.ok(official > scoreOfKind("MUSIC_VIDEO_TYPE_UGC"));
});

test("a podcast episode and the shoulder tier score below an art track", () => {
  const art = scoreOfKind("MUSIC_VIDEO_TYPE_ATV");
  assert.ok(scoreOfKind("MUSIC_VIDEO_TYPE_PODCAST_EPISODE") < art);
  assert.ok(scoreOfKind("MUSIC_VIDEO_TYPE_SHOULDER") < art);
});

test("an unrecognised kind still sits between user uploads and art tracks", () => {
  const unknown = scoreOfKind("MUSIC_VIDEO_TYPE_SOMETHING_NEW");
  assert.equal(unknown, scoreOfKind(null));
  assert.ok(unknown < scoreOfKind("MUSIC_VIDEO_TYPE_UGC"));
  assert.ok(unknown > scoreOfKind("MUSIC_VIDEO_TYPE_ATV"));
});

test("one artist holding every top score does not take every top slot", () => {
  const ranking = [
    track("One", "Alpha"),
    track("Two", "Alpha"),
    track("Three", "Alpha"),
    track("Four", "Beta"),
    track("Five", "Gamma"),
    track("Six", "Delta"),
  ];
  const artists = recommend([list("a", ranking), list("b", ranking)], { limit: 4 }).map(
    (song) => song.artists[0],
  );

  assert.ok(
    artists.every((artist, index) => artist !== artists[index - 1]),
    `same artist twice in a row: ${artists.join(", ")}`,
  );
  assert.equal(artists[0], "Alpha");
});

test("spacing reorders but never drops, even when one artist owns everything left", () => {
  const alpha = [track("One", "Alpha"), track("Two", "Alpha"), track("Three", "Alpha")];
  const ranking = [...alpha, track("Other", "Beta")];

  assert.equal(recommend([list("a", ranking), list("b", ranking)], { limit: 4 }).length, 4);
  assert.equal(recommend([list("a", alpha)], { limit: 3 }).length, 3);
});

test("excluded songs are dropped however they were spelled", () => {
  const lists = [list("a", [track("Wonderwall (Remastered)", "Oasis"), track("Keep", "Beta")])];
  const excluded = scoreCandidates([list("x", [track("Wonderwall", "Oasis")])]).map(
    (entry) => entry.song,
  );
  assert.deepEqual(titles(recommend(lists, { limit: 5, exclude: excluded })), ["Keep"]);
});

test("a music video and its audio track are one entry, however the title is decorated", () => {
  for (const [video, audio, artist] of [
    ["Watermelon Sugar (Official Video)", "Watermelon Sugar", "Harry Styles"],
    ["Levitating (feat. DaBaby)", "Levitating", "Dua Lipa"],
  ] as const) {
    const yt = track(video, artist, { durationMs: 189_000, videoType: "MUSIC_VIDEO_TYPE_OMV" });
    const dz = track(audio, artist, { source: "deezer", durationMs: 174_000 });
    const picked = recommend([list("yt", [yt]), list("dz", [dz])], { limit: 5 });
    assert.equal(picked.length, 1, video);
    assert.ok(picked[0]!.sources.some((source) => source.source === "ytmusic"));
  }
});

test("a repeat inside one list is the same evidence, not more of it", () => {
  const scored = scoreCandidates([
    list("a", [track("Repeated", "Alpha"), track("Once", "Beta"), track("Repeated", "Alpha")]),
  ]);
  assert.equal(scored.find((entry) => entry.song.title === "Repeated")!.lists, 1);
});

test("an empty list changes nothing, and no lists at all is empty rather than an error", () => {
  const withList = recommend([list("a", [track("One", "Alpha")])], { limit: 5 });
  const withEmpty = recommend([list("a", [track("One", "Alpha")]), list("dead", [])], { limit: 5 });
  assert.deepEqual(titles(withEmpty), titles(withList));
  assert.deepEqual(recommend([], { limit: 5 }), []);
  assert.deepEqual(scoreCandidates([list("a", [])]), []);
});

test("the limit is respected", () => {
  const tracks = Array.from({ length: 30 }, (_, index) => track(`Song ${index}`, `Artist ${index}`));
  assert.equal(recommend([list("a", tracks)], { limit: 8 }).length, 8);
});

test("a feature credited in one list and dropped in the other is still agreement", () => {
  const lists = [
    list("yt", [track("Filler One", "Alpha"), track("Sunflower (feat. Swae Lee)", "Post Malone")]),
    list("dz", [
      track("Filler Two", "Gamma", { source: "deezer" }),
      track("Sunflower", "Post Malone", { source: "deezer" }),
    ]),
  ];
  const sunflower = scoreCandidates(lists).find((entry) => entry.song.title.startsWith("Sunflower"))!;

  assert.equal(sunflower.lists, 2);
  assert.equal(titles(recommend(lists, { limit: 5 }))[0], "Sunflower (feat. Swae Lee)");
});

test("the seed is excluded however its feature is credited", () => {
  const lists = [
    list("yt", [track("Sunflower (feat. Swae Lee)", "Post Malone"), track("Keep", "Beta")]),
  ];
  const picked = recommend(lists, {
    limit: 5,
    exclude: [{ title: "Sunflower", artists: ["Post Malone"] }],
  });
  assert.deepEqual(titles(picked), ["Keep"]);
});
