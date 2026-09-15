import assert from "node:assert/strict";
import { test } from "node:test";

import { consensusArtist, rankSearchResults } from "./rank.ts";
import type { Playback, SourceId, SourceTrack } from "./types.ts";

function track(
  source: SourceId,
  title: string,
  artists: string[],
  extra: Partial<SourceTrack> = {},
): SourceTrack {
  return {
    source,
    sourceId: `${source}:${title}`,
    title,
    artists,
    album: null,
    durationMs: 259_000,
    isrc: null,
    url: null,
    artworkUrl: null,
    playback: source === "apple" || source === "deezer" ? "link" : "queue",
    ...extra,
  };
}

// The order `/api/search?q=wonderwall` actually returned: a cover first, then live cuts, DJ sets
// and remixes, with the Oasis recording sixty rows down where nobody scrolls.
const wonderwall: SourceTrack[] = [
  track("soundcloud", "Wonderwall", ["Josh Fawaz"], { durationMs: 134_046 }),
  track("audius", "Wonderwall (cover)", ["midium"], { durationMs: 207_000 }),
  track("mixcloud", "Mix Alternativo 90's - Wonderwall (Dj Maxo) Zerooo Radioo 106.7fm", ["DjMaxo"], {
    durationMs: 5_308_000,
  }),
  track("soundcloud", "12. Oasis - Wonderwall (Live)", ["changhee333"]),
  track("audius", "Yellow x Wonderwall", ["Bryce"]),
  track("soundcloud", "OASIS - WONDERWALL (FITCH & HEXL REMIX)", ["Fitch"]),
  track("audius", "Wonderwall", ["Ryan Adams"]),
  track("deezer", "Wonderwall (Live from Dublin, 16 August '25)", ["Oasis"], { durationMs: 280_000 }),
  track("apple", "Wonderwall", ["Oasis"]),
  track("apple", "Wonderwall (Unplugged)", ["Oasis"], { durationMs: 250_000 }),
  track("deezer", "Wonderwall (Live at Wembley Stadium, 2000)", ["Oasis"], { durationMs: 290_000 }),
];

const titles = (tracks: SourceTrack[]) => tracks.map((found) => `${found.title} — ${found.artists[0]}`);

test("the studio recording leads, and every other version is still on the page", () => {
  const ranked = rankSearchResults(wonderwall, "wonderwall");

  assert.equal(titles(ranked)[0], "Wonderwall — Oasis");
  assert.equal(ranked.length, wonderwall.length, "a variant is demoted, never dropped");
  assert.deepEqual(
    new Set(ranked.map((found) => found.sourceId)),
    new Set(wonderwall.map((found) => found.sourceId)),
  );
});

test("a cover credited to somebody else does not outrank the song it is covering", () => {
  const ranked = titles(rankSearchResults(wonderwall, "wonderwall"));
  const studio = ranked.indexOf("Wonderwall — Oasis");

  for (const cover of ["Wonderwall — Josh Fawaz", "Wonderwall (cover) — midium", "Wonderwall — Ryan Adams"]) {
    assert.ok(ranked.indexOf(cover) > studio, `${cover} should rank below the studio recording`);
  }
});

test("live cuts, remixes and hour-long mixes all fall below the plain recording", () => {
  const ranked = titles(rankSearchResults(wonderwall, "wonderwall"));
  const studio = ranked.indexOf("Wonderwall — Oasis");

  for (const variant of [
    "Wonderwall (Live from Dublin, 16 August '25) — Oasis",
    "Wonderwall (Live at Wembley Stadium, 2000) — Oasis",
    "Wonderwall (Unplugged) — Oasis",
    "12. Oasis - Wonderwall (Live) — changhee333",
    "OASIS - WONDERWALL (FITCH & HEXL REMIX) — Fitch",
    "Mix Alternativo 90's - Wonderwall (Dj Maxo) Zerooo Radioo 106.7fm — DjMaxo",
  ]) {
    assert.ok(ranked.indexOf(variant) > studio, `${variant} should rank below the studio recording`);
  }
});

test("asking for a version promotes it, and the studio take gives way", () => {
  const ranked = titles(rankSearchResults(wonderwall, "wonderwall live"));

  assert.ok(
    ranked[0]!.includes("Live"),
    `a live take should lead a search for a live take, got ${ranked[0]}`,
  );
  assert.ok(
    ranked.indexOf("Wonderwall — Oasis") > ranked.indexOf("Wonderwall (Live at Wembley Stadium, 2000) — Oasis"),
    "the studio recording is not what was asked for",
  );
});

test("an unplugged search finds the unplugged cut, not the studio one", () => {
  const ranked = titles(rankSearchResults(wonderwall, "wonderwall acoustic"));
  assert.equal(ranked[0], "Wonderwall (Unplugged) — Oasis");
});

test("the corpus agrees on the artist nobody typed", () => {
  assert.equal(consensusArtist(wonderwall, "wonderwall"), "oasis");
  assert.equal(
    consensusArtist([track("apple", "Halo", ["Beyoncé"]), track("deezer", "Halo", ["Ed Sheeran"])], "halo"),
    null,
    "two comparable artists are not a consensus",
  );
  assert.equal(
    consensusArtist(wonderwall, "oasis wonderwall"),
    null,
    "a name the reader already typed is scored by the query, not by the crowd",
  );
});

test("a query the results cannot separate keeps the playability order it arrived in", () => {
  const equal: SourceTrack[] = [
    track("soundcloud", "Jóga", ["Björk"]),
    track("audius", "Jóga", ["Björk"]),
    track("deezer", "Jóga", ["Björk"]),
  ];
  assert.deepEqual(
    rankSearchResults(equal, "joga").map((found) => found.source),
    ["soundcloud", "audius", "deezer"],
  );
});

test("a song whose own name contains a version word is not demoted for it", () => {
  const tracks: SourceTrack[] = [
    track("audius", "Live Forever (Karaoke Version)", ["Sing2Music"]),
    track("apple", "Live Forever", ["Oasis"]),
  ];
  assert.equal(titles(rankSearchResults(tracks, "live forever"))[0], "Live Forever — Oasis");
});

test("the words of the query all have to be there", () => {
  const tracks: SourceTrack[] = [
    track("soundcloud", "Wonderwall", ["Some Uploader"]),
    track("soundcloud", "Champagne Supernova", ["Oasis"]),
  ];
  assert.equal(
    titles(rankSearchResults(tracks, "champagne supernova"))[0],
    "Champagne Supernova — Oasis",
  );
});

test("naming the artist finds the recording, not the upload named after the search box", () => {
  // Measured on /api/search?q=bjork+joga and ?q=daft+punk+around+the+world: the rows that led
  // were re-uploads whose titles repeat the query word for word.
  const tracks: SourceTrack[] = [
    track("soundcloud", "Björk Joga", ["Angelic-x"]),
    track("soundcloud", "bjork - joga", ["person"]),
    track("soundcloud", "Jóga", ["Björk"]),
    track("deezer", "Jóga", ["Björk"]),
  ];
  const ranked = rankSearchResults(tracks, "bjork joga");
  assert.equal(titles(ranked)[0], "Jóga — Björk");
  assert.equal(ranked[0]!.source, "soundcloud", "the playable copy of the right song leads");
});

test("the artist half of the query is not counted against the title", () => {
  const tracks: SourceTrack[] = [
    track("soundcloud", "Daft Punk   Around The World", ["Sabrina Medeiros"]),
    track("deezer", "Around the World", ["Daft Punk"], { durationMs: 429_000 }),
  ];
  assert.equal(
    titles(rankSearchResults(tracks, "daft punk around the world"))[0],
    "Around the World — Daft Punk",
  );
});

test("playability still decides between two answers the query cannot separate", () => {
  const tracks: SourceTrack[] = [
    track("apple", "Jóga", ["Björk"], { playback: "link" as Playback }),
    track("soundcloud", "Jóga", ["Björk"], { playback: "queue" as Playback }),
  ];
  assert.deepEqual(
    rankSearchResults(tracks, "joga").map((found) => found.source),
    ["soundcloud", "apple"],
  );
});
