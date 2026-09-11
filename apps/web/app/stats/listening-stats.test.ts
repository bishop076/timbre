import assert from "node:assert/strict";
import { test } from "node:test";

import type { PlayedSong } from "../player/history-store";
import { listeningStats, playsFrom, type Play } from "./listening-stats.ts";
import { appendPlay, EMPTY_LOG, parsePlayLog, type PlayLog } from "./play-log.ts";

function song(id: string, artists: unknown = ["Someone"]): PlayedSong {
  return {
    id,
    title: `Song ${id}`,
    artists: artists as string[],
    artworkUrl: null,
    videoId: null,
  };
}

function at(day: number, hour = 12): number {
  return new Date(2026, 8, 7 + day, hour).getTime();
}

function logOf(...plays: [PlayedSong, number][]): PlayLog {
  return plays.reduce((log, [played, when]) => appendPlay(log, played, when), EMPTY_LOG);
}

test("a repeat is another play of the same song, not another song", () => {
  const stats = listeningStats(playsFrom(logOf([song("a"), at(0)], [song("a"), at(1)], [song("b"), at(2)]), []));
  assert.equal(stats.total, 3);
  assert.deepEqual(
    stats.songs.map((entry) => [entry.song.id, entry.plays]),
    [
      ["a", 2],
      ["b", 1],
    ],
  );
  assert.equal(stats.songs[0]!.lastAt, at(1));
});

test("artists group across case and accents, keep their latest spelling, and count songs apart from plays", () => {
  const stats = listeningStats(
    playsFrom(
      logOf(
        [song("a", ["Beyoncé"]), at(0)],
        [song("a", ["Beyoncé"]), at(0, 13)],
        [song("b", ["BEYONCE"]), at(1)],
        [song("c", ["Pixies"]), at(2)],
      ),
      [],
    ),
  );
  assert.deepEqual(stats.artists, [
    { key: "beyonce", name: "BEYONCE", plays: 3, songs: 2 },
    { key: "pixies", name: "Pixies", plays: 1, songs: 1 },
  ]);
});

test("every credited artist gets the play, but a name listed twice counts once", () => {
  const stats = listeningStats([{ song: song("a", ["Daft Punk", "Pharrell", "daft punk"]), at: at(0) }]);
  assert.deepEqual(
    stats.artists.map((artist) => [artist.name, artist.plays]),
    [
      ["Daft Punk", 1],
      ["Pharrell", 1],
    ],
  );
});

test("ties go to whoever was played most recently", () => {
  const stats = listeningStats(playsFrom(logOf([song("old", ["Old"]), at(0)], [song("new", ["New"]), at(1)]), []));
  assert.deepEqual(
    stats.artists.map((artist) => artist.name),
    ["New", "Old"],
  );
  assert.deepEqual(
    stats.songs.map((entry) => entry.song.id),
    ["new", "old"],
  );
});

test("history the log never saw counts once, undated, until the log is full", () => {
  const log = logOf([song("a"), at(3)]);
  const history = [song("a"), song("legacy")];

  const partial = listeningStats(playsFrom(log, history));
  assert.equal(partial.total, 2);
  assert.equal(partial.dated, 1);
  assert.equal(partial.undated, 1);
  assert.deepEqual(partial.weekdays, [0, 0, 0, 1, 0, 0, 0]);

  const full = playsFrom(log, history, 1);
  assert.deepEqual(
    full.map((play) => play.song.id),
    ["a"],
  );
});

test("nothing played is zeroes, not a crash", () => {
  const stats = listeningStats(playsFrom(EMPTY_LOG, []));
  assert.equal(stats.total, 0);
  assert.equal(stats.first, null);
  assert.equal(stats.days, 0);
  assert.deepEqual(stats.artists, []);
});

test("dates cover the dated plays only, in calendar days", () => {
  const plays: Play[] = [
    { song: song("c"), at: at(6, 23) },
    { song: song("b"), at: at(0, 1) },
    { song: song("a"), at: null },
  ];
  const stats = listeningStats(plays);
  assert.equal(stats.first, at(0, 1));
  assert.equal(stats.last, at(6, 23));
  assert.equal(stats.days, 7);
  assert.deepEqual(stats.weekdays, [1, 0, 0, 0, 0, 0, 1]);
});

test("a song with no usable artists still counts as a play", () => {
  const stats = listeningStats([
    { song: song("a", []), at: at(0) },
    { song: song("b", "not an array"), at: at(0) },
    { song: song("c", [42, " "]), at: at(0) },
  ]);
  assert.equal(stats.total, 3);
  assert.deepEqual(stats.artists, []);
});

test("the log keeps the newest plays and forgets songs nothing refers to", () => {
  let log = EMPTY_LOG;
  log = appendPlay(log, song("a"), 1, 2);
  log = appendPlay(log, song("b"), 2, 2);
  log = appendPlay(log, song("c"), 3, 2);
  assert.deepEqual(log.plays, [
    ["c", 3],
    ["b", 2],
  ]);
  assert.deepEqual(Object.keys(log.songs).sort(), ["b", "c"]);
});

test("the newest record of a song replaces the one stored with it", () => {
  const log = appendPlay(appendPlay(EMPTY_LOG, song("a"), 1), { ...song("a"), title: "Renamed" }, 2);
  assert.equal(log.songs.a!.title, "Renamed");
});

test("a malformed stored log drops what it cannot use rather than throwing", () => {
  assert.equal(parsePlayLog(null), EMPTY_LOG);
  assert.equal(parsePlayLog({ plays: "no", songs: {} }), EMPTY_LOG);

  const parsed = parsePlayLog({
    plays: [["a", 5], ["missing", 4], ["a", "yesterday"], "junk", ["b", Number.NaN], ["b", 3]],
    songs: { a: song("a"), b: song("b"), c: song("c"), d: { id: "d" }, e: song("not-e") },
  });
  assert.deepEqual(parsed.plays, [
    ["a", 5],
    ["b", 3],
  ]);
  assert.deepEqual(Object.keys(parsed.songs).sort(), ["a", "b"]);
});

test("an id that is also an object property is not mistaken for a stored song", () => {
  const stats = listeningStats(playsFrom(EMPTY_LOG, [song("constructor")]));
  assert.equal(stats.total, 1);
  assert.equal(stats.undated, 1);
});
