import assert from "node:assert/strict";
import { test } from "node:test";

import type { PlayedSong } from "../player/history-store";
import {
  genreSpread,
  listeningStats,
  playsFrom,
  playsOverTime,
  playsWithin,
  type Play,
} from "./listening-stats.ts";
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
  let log = appendPlay(EMPTY_LOG, song("a"), 1, 2);
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

/* ---------------------------------------------------------------------------
   Periods, the timeline and the genre spread.
   --------------------------------------------------------------------------- */

const NOW = new Date(2026, 8, 15, 14, 30).getTime(); // Tue 15 Sept 2026, 14:30 local

const on = (year: number, month: number, day: number, hour = 12): number =>
  new Date(year, month, day, hour).getTime();

const playAt = (id: string, at: number | null): Play => ({ song: song(id), at });

test("a period is measured in calendar days, so today counts whole and the cutoff is a midnight", () => {
  const plays = [
    playAt("today-early", on(2026, 8, 15, 0)),
    playAt("today-late", on(2026, 8, 15, 23)),
    playAt("seventh-day", on(2026, 8, 9, 0)), // midnight of the 7th day back — inside
    playAt("eighth-day", on(2026, 8, 8, 23)), // one minute earlier — outside
  ];

  assert.deepEqual(
    playsWithin(plays, 7, NOW).map((play) => play.song.id),
    ["today-early", "today-late", "seventh-day"],
  );
});

test("a play from before Timbre kept times belongs to all time and to no shorter period", () => {
  const plays = [playAt("dated", on(2026, 8, 14)), playAt("undated", null)];

  assert.deepEqual(
    playsWithin(plays, 30, NOW).map((play) => play.song.id),
    ["dated"],
  );
  assert.equal(playsWithin(plays, null, NOW).length, 2);
});

test("all time is every play, and the filter does not hand back the caller's array", () => {
  const plays = [playAt("a", on(2026, 8, 14))];
  const all = playsWithin(plays, null, NOW);

  assert.deepEqual(all, plays);
  assert.notEqual(all, plays);
});

test("the timeline keeps the quiet days, which are the ones worth seeing", () => {
  // Three plays on one day out of seven. Binning only the days that have plays would draw a
  // single full-height column and an axis claiming a week of steady listening.
  const plays = [
    playAt("a", on(2026, 8, 13, 9)),
    playAt("a", on(2026, 8, 13, 10)),
    playAt("b", on(2026, 8, 13, 11)),
  ];

  const { buckets, grain } = playsOverTime(plays, 7, NOW);

  assert.equal(grain, "day");
  assert.equal(buckets.length, 7);
  assert.deepEqual(
    buckets.map((bucket) => bucket.plays),
    [0, 0, 0, 0, 3, 0, 0],
  );
});

test("a month of days is labelled sparsely, ending on the newest column", () => {
  const { buckets } = playsOverTime([playAt("a", on(2026, 8, 15))], 30, NOW);

  assert.equal(buckets.length, 30);
  assert.notEqual(buckets.at(-1)!.axis, "");
  assert.ok(buckets.filter((bucket) => bucket.axis !== "").length <= 8);
  // Every column still names itself in full for the tooltip and the table.
  assert.ok(buckets.every((bucket) => bucket.label.length > 0));
  assert.equal(new Set(buckets.map((bucket) => bucket.key)).size, 30);
});

test("all time coarsens rather than drawing a column per day of a year", () => {
  const long = [playAt("a", on(2025, 0, 6)), playAt("a", NOW)];
  const middling = [playAt("a", on(2026, 5, 1)), playAt("a", NOW)];
  const short = [playAt("a", on(2026, 8, 1)), playAt("a", NOW)];

  assert.equal(playsOverTime(long, null, NOW).grain, "month");
  assert.equal(playsOverTime(middling, null, NOW).grain, "week");
  assert.equal(playsOverTime(short, null, NOW).grain, "day");
  assert.ok(playsOverTime(long, null, NOW).buckets.length <= 24);
});

test("nothing dated is an empty timeline, not a crash or a chart back to 1970", () => {
  // `Math.min()` of nothing is Infinity, which is a range from the end of time to today.
  const timeline = playsOverTime([playAt("a", null)], null, NOW);

  assert.deepEqual(timeline.buckets, []);
  assert.equal(timeline.undated, 1);
});

test("the genre spread says how much of the listening it could not name", () => {
  const artists = [
    { key: "a", name: "Aphex Twin", plays: 30, songs: 4 },
    { key: "b", name: "Boards of Canada", plays: 20, songs: 2 },
    { key: "c", name: "Kendrick Lamar", plays: 10, songs: 3 },
    { key: "d", name: "Nobody Looked Up", plays: 40, songs: 1 },
  ];
  const genres: Record<string, number> = {
    "Aphex Twin": 106,
    "Boards of Canada": 106,
    "Kendrick Lamar": 116,
  };
  const names: Record<number, string> = { 106: "Electro", 116: "Rap/Hip Hop" };

  const spread = genreSpread(
    artists,
    (name) => genres[name] ?? null,
    (id) => names[id],
  );

  assert.deepEqual(
    spread.genres.map((genre) => [genre.name, genre.plays, genre.artists]),
    [
      ["Electro", 50, ["Aphex Twin", "Boards of Canada"]],
      ["Rap/Hip Hop", 10, ["Kendrick Lamar"]],
    ],
  );
  assert.equal(spread.placed, 60);
  assert.equal(spread.unplaced, 40);
});

test("a genre whose name never arrived is unplaced, not a bar called undefined", () => {
  const spread = genreSpread(
    [{ key: "a", name: "Aphex Twin", plays: 5, songs: 1 }],
    () => 999,
    () => undefined,
  );

  assert.deepEqual(spread.genres, []);
  assert.equal(spread.unplaced, 5);
});

test("days you listened is counted apart from the days the window spans", () => {
  // Two plays on one day, one a week later: an eight-day window with two days in it. The figure
  // on the page is the second number — over a fixed period the first is always the period.
  const stats = listeningStats([
    playAt("a", on(2026, 8, 1, 9)),
    playAt("a", on(2026, 8, 1, 21)),
    playAt("b", on(2026, 8, 8, 12)),
  ]);

  assert.equal(stats.days, 8);
  assert.equal(stats.activeDays, 2);
});

test("a play with no date is in no day, so it lifts neither count", () => {
  const stats = listeningStats([playAt("a", on(2026, 8, 1)), playAt("b", null)]);

  assert.equal(stats.total, 2);
  assert.equal(stats.activeDays, 1);
});
