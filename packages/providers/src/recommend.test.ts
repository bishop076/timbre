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
    isExplicit: false,
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
  // "Agreed" is second in both lists; "Solo" is first in one and absent from the other.
  const lists = [
    list("a", [track("Solo", "Alpha"), track("Agreed", "Beta")]),
    list("b", [track("Other", "Gamma"), track("Agreed", "Beta")]),
  ];

  const ranked = recommend(lists, { limit: 5 });
  assert.equal(ranked[0]!.title, "Agreed");
});

test("three lists agreeing beats two", () => {
  const lists = [
    list("a", [track("Twice", "Alpha"), track("Thrice", "Beta")]),
    list("b", [track("Twice", "Alpha"), track("Thrice", "Beta")]),
    list("c", [track("Filler", "Gamma"), track("Thrice", "Beta")]),
  ];

  const scored = scoreCandidates(lists);
  const thrice = scored.find((entry) => entry.song.title === "Thrice")!;
  const twice = scored.find((entry) => entry.song.title === "Twice")!;

  assert.equal(thrice.lists, 3);
  assert.equal(twice.lists, 2);
  assert.ok(thrice.score > twice.score);
});

test("cross-source agreement survives the merge into one song", () => {
  const lists = [
    list("yt", [track("Shared", "Alpha", { source: "ytmusic" })]),
    list("dz", [track("Shared", "Alpha", { source: "deezer" })]),
  ];

  const scored = scoreCandidates(lists);
  assert.equal(scored.length, 1);
  assert.equal(scored[0]!.lists, 2);
  assert.deepEqual(
    scored[0]!.song.sources.map((source) => source.source),
    ["ytmusic", "deezer"],
  );
});

test("an art track is demoted below an official video that ranked equally", () => {
  const lists = [
    list("a", [
      track("Art", "Alpha", { videoType: "MUSIC_VIDEO_TYPE_ATV" }),
      track("Official", "Beta", { videoType: "MUSIC_VIDEO_TYPE_OMV" }),
    ]),
    list("b", [
      track("Official", "Beta", { videoType: "MUSIC_VIDEO_TYPE_OMV" }),
      track("Art", "Alpha", { videoType: "MUSIC_VIDEO_TYPE_ATV" }),
    ]),
  ];

  // Both rank equally, so fusion alone ties them; measured embed failure breaks it.
  assert.equal(recommend(lists, { limit: 2 })[0]!.title, "Official");
});

test("one artist holding every top score does not take every top slot", () => {
  // Alpha holds ranks 1-3 in both lists; the alternatives are ranked below all of them.
  const ranking = [
    track("One", "Alpha"),
    track("Two", "Alpha"),
    track("Three", "Alpha"),
    track("Four", "Beta"),
    track("Five", "Gamma"),
    track("Six", "Delta"),
  ];
  const lists = [list("a", ranking), list("b", ranking)];

  const artists = recommend(lists, { limit: 4 }).map((song) => song.artists[0]);

  // A plain sort by score would return Alpha, Alpha, Alpha, Beta.
  for (let index = 1; index < artists.length; index += 1) {
    if (artists[index] === artists[index - 1]) {
      assert.fail(`same artist twice in a row at ${index}: ${artists.join(", ")}`);
    }
  }
  // Alpha still leads — spacing reorders, it does not punish.
  assert.equal(artists[0], "Alpha");
});

test("spacing yields when an artist genuinely owns everything left", () => {
  // Three Alpha songs in four slots cannot avoid adjacency, so the window gives way.
  const ranking = [
    track("One", "Alpha"),
    track("Two", "Alpha"),
    track("Three", "Alpha"),
    track("Other", "Beta"),
  ];

  const picked = recommend([list("a", ranking), list("b", ranking)], { limit: 4 });
  assert.equal(picked.length, 4);
});

test("spacing artists out reorders but never drops", () => {
  const lists = [
    list("a", [track("One", "Alpha"), track("Two", "Alpha"), track("Three", "Alpha")]),
  ];

  assert.equal(recommend(lists, { limit: 3 }).length, 3);
});

test("excluded songs are dropped however they were spelled", () => {
  const lists = [list("a", [track("Wonderwall (Remastered)", "Oasis"), track("Keep", "Beta")])];

  const excluded = scoreCandidates([list("x", [track("Wonderwall", "Oasis")])]).map(
    (entry) => entry.song,
  );

  assert.deepEqual(titles(recommend(lists, { limit: 5, exclude: excluded })), ["Keep"]);
});

test("a music video and its audio track are one entry, not two", () => {
  // The merger keeps these apart on purpose — 189s against 174s is outside its tolerance
  // — but the same song twice in a radio is a defect.
  const lists = [
    list("yt", [
      track("Watermelon Sugar (Official Video)", "Harry Styles", {
        durationMs: 189_000,
        videoType: "MUSIC_VIDEO_TYPE_OMV",
      }),
    ]),
    list("dz", [
      track("Watermelon Sugar", "Harry Styles", { source: "deezer", durationMs: 174_000 }),
    ]),
  ];

  const picked = recommend(lists, { limit: 5 });
  assert.equal(picked.length, 1);
  // The survivor is the copy that can actually be played.
  assert.ok(picked[0]!.sources.some((source) => source.source === "ytmusic"));
});

test("a repeat inside one list is the same evidence, not more of it", () => {
  const lists = [
    list("a", [track("Repeated", "Alpha"), track("Once", "Beta"), track("Repeated", "Alpha")]),
  ];

  const scored = scoreCandidates(lists);
  assert.equal(scored.find((entry) => entry.song.title === "Repeated")!.lists, 1);
});

test("an empty or failed list changes nothing", () => {
  const withList = recommend([list("a", [track("One", "Alpha")])], { limit: 5 });
  const withEmpty = recommend([list("a", [track("One", "Alpha")]), list("dead", [])], { limit: 5 });

  assert.deepEqual(titles(withEmpty), titles(withList));
});

test("no lists at all is empty, not an error", () => {
  assert.deepEqual(recommend([], { limit: 5 }), []);
  assert.deepEqual(scoreCandidates([list("a", [])]), []);
});

test("the limit is respected", () => {
  const lists = [
    list("a", Array.from({ length: 30 }, (_, index) => track(`Song ${index}`, `Artist ${index}`))),
  ];

  assert.equal(recommend(lists, { limit: 8 }).length, 8);
});
