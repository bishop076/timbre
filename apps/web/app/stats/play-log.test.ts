import assert from "node:assert/strict";
import { test } from "node:test";

import { listeningStats, playsFrom } from "./listening-stats.ts";
import { appendPlay, EMPTY_LOG, parsePlayLog, playedSong, PLAY_LOG_LIMIT } from "./play-log.ts";

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

/* ---------------------------------------------------------------------------
   What a stored song and a stored time have to be.
   --------------------------------------------------------------------------- */

const logWith = (songs: Record<string, unknown>, plays: unknown[]) => ({ plays, songs });

test("a stored song whose artists are not a list is dropped, not handed to the page", () => {
  // The two stores held the same records under different rules: history insisted on an array of
  // strings, the log asked for an id and a title. `/stats` renders a logged song through
  // `songFromHistory` into `<ArtistLink>`, and `artists.join(", ")` on the string "Someone"
  // throws — the whole page, not the one row.
  const parsed = parsePlayLog(
    logWith(
      {
        a: { id: "a", title: "A", artists: "Someone", artworkUrl: null, videoId: null },
        b: { id: "b", title: "B", artworkUrl: null, videoId: null },
        c: { id: "c", title: "C", artists: [1, 2], artworkUrl: null, videoId: null },
        d: { id: "d", title: "D", artists: ["Someone"], artworkUrl: null, videoId: null },
      },
      [
        ["a", 1_700_000_000_000],
        ["b", 1_700_000_000_001],
        ["c", 1_700_000_000_002],
        ["d", 1_700_000_000_003],
      ],
    ),
  );

  assert.deepEqual(Object.keys(parsed.songs), ["d"]);
  assert.deepEqual(
    parsed.plays.map(([id]) => id),
    ["d"],
  );

  // And what the page then does with it does not throw.
  for (const [id] of parsed.plays) {
    assert.doesNotThrow(() => parsed.songs[id]!.artists.join(", "));
  }
});

/* ---------------------------------------------------------------------------
   The three fields the log used to wave past: a source, its link, and the
   artist a song was played from.
   --------------------------------------------------------------------------- */

const played = (extra: Record<string, unknown>) => ({
  id: "audius:abc",
  title: "Delilah",
  artists: ["Someone"],
  artworkUrl: null,
  videoId: null,
  ...extra,
});

test("a played song Timbre wrote comes back with every field it had", () => {
  // The guard on everything below: this rule is only allowed to refuse what a reader could not
  // have got from a provider in the first place.
  const real = played({
    source: "soundcloud",
    sourceId: "1",
    url: "https://soundcloud.com/flume/never-be-like-you",
    videoId: "dQw4w9WgXcQ",
    from: { kind: "artist", name: "Flume", imageUrl: null },
  });
  assert.deepEqual(playedSong(real), real);
});

test("a stored link that does not belong to its source is dropped, and the play kept", () => {
  // `songFromHistory` turns this straight into `Song.sources[0].url`, and the now-playing panel
  // renders that as the `<a href>` behind "Can't play this here". Proven on a production build:
  // one hand-edited `timbre:history` entry pointed that link at https://evil.example/. The same
  // string in a playlist has been refused for some time — only history never asked.
  for (const url of [
    "javascript:void(0)",
    "https://evil.example/phishing-login",
    "http://soundcloud.com/a/b",
    "https://soundcloud.com.evil.example/a/b",
  ]) {
    const song = playedSong(played({ source: "soundcloud", sourceId: "1", url }));
    assert.equal(song?.title, "Delilah", `${url} must not cost the play`);
    assert.equal(song?.url, null, `${url} names no host SoundCloud serves`);
  }

  const kept = "https://soundcloud.com/flume/never-be-like-you";
  assert.equal(playedSong(played({ source: "soundcloud", sourceId: "1", url: kept }))?.url, kept);
});

test("a played source named after a property of Object keeps no link either", () => {
  // The same class of bug, on the reader that never had the guard. The host table answers "constructor"
  // with a function rather than with nothing, so the check has to be `Object.hasOwn` on both
  // sides of it or the second reader reintroduces what the first one fixed.
  for (const name of ["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty"]) {
    const song = playedSong(played({ source: name, sourceId: "x", url: "https://soundcloud.com/a/b" }));
    assert.equal(song?.source, name, `${name} should survive as a name`);
    assert.equal(song?.url, null, `${name} names no host, so it keeps no link`);
  }
});

test("a play context the page cannot render is dropped, not passed on", () => {
  // `songFromHistory` copies `from` into the `Song`, and the "Recently played" shelf reads
  // `current.from.name.toLowerCase()` on every render while something is playing. A stored
  // `{ kind: "artist", name: 5 }` made that a TypeError: on a production build, pressing play
  // on the entry replaced the whole home page with "This page stopped working."
  assert.equal(playedSong(played({ from: { kind: "artist", name: 5 } }))?.from, undefined);
  assert.equal(playedSong(played({ from: { kind: "album", name: "x" } }))?.from, undefined);
  assert.equal(playedSong(played({ from: "Oasis" }))?.from, undefined);
  assert.deepEqual(playedSong(played({ from: { kind: "artist", name: "Oasis" } }))?.from, {
    kind: "artist",
    name: "Oasis",
    imageUrl: null,
  });
  // And what the shelf then does with it does not throw.
  const from = playedSong(played({ from: { kind: "artist", name: 5 } }))?.from;
  assert.doesNotThrow(() => from?.kind === "artist" && from.name.toLowerCase());
});

test("a video id that is not a string is no video id", () => {
  // `songFromHistory` interpolates this into a watch URL and the home shelf puts it in a
  // /api/radio query; `PlayedSong` says `string | null` and nothing held it to that.
  assert.equal(playedSong(played({ videoId: { toString: "no" } }))?.videoId, null);
  assert.equal(playedSong(played({ videoId: 7 }))?.videoId, null);
  assert.equal(playedSong(played({ videoId: "dQw4w9WgXcQ" }))?.videoId, "dQw4w9WgXcQ");
});

test("a time no Date can represent is not a time", () => {
  // `Number.isFinite` was the whole guard, and 1e20 passes it while `new Date(1e20)` is an
  // Invalid Date. One of those in the log made `days` NaN, printed "Invalid Date" in the range
  // line, and ran `weekdays[NaN] += 1` — which puts a NaN key on the tally array.
  const good = 1_700_000_000_000;
  const parsed = parsePlayLog(
    logWith({ a: song("a") }, [["a", 1e20], ["a", -1], ["a", 0], ["a", good]]),
  );

  assert.deepEqual(parsed.plays, [["a", good]]);

  const stats = listeningStats(playsFrom(parsed, []));
  assert.equal(stats.days, 1);
  assert.ok(Number.isFinite(stats.first));
  assert.deepEqual(Object.keys(stats.weekdays), ["0", "1", "2", "3", "4", "5", "6"]);
});

let instance = 0;

/** A browser whose `localStorage` refuses anything over `budget` characters, as a full one does. */
async function fresh(budget: number, seed?: Record<string, string>) {
  const backing: Record<string, string> = { ...seed };

  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => backing[key] ?? null,
      setItem: (key: string, value: string) => {
        if (value.length > budget) {
          const error = new Error("exceeded the quota");
          error.name = "QuotaExceededError";
          throw error;
        }
        backing[key] = value;
      },
      removeItem: (key: string) => {
        delete backing[key];
      },
    },
  };

  instance += 1;
  const log = await import(`./play-log.ts?instance=${instance}`);
  return { log, backing };
}

const KEY = "timbre:plays";

test("a browser too full for the whole log still counts the newest play", async () => {
  const many = Array.from({ length: 200 }, (_, index) => song(`audius:${index}`));
  const full = {
    plays: many.map((entry, index) => [entry.id, 1_700_000_000_000 + index]),
    songs: Object.fromEntries(many.map((entry) => [entry.id, entry])),
  };
  const stored = JSON.stringify(full);

  // Room for what is already there, and not a character more.
  const { log, backing } = await fresh(stored.length, { [KEY]: stored });
  log.logPlay(song("audius:new"), 1_800_000_000_000);

  // The write used to be attempted once and its failure swallowed: the play lived in this tab
  // and never reached storage, every play after it failed the same way, and a reload threw the
  // lot away. /stats froze on the day the browser filled up.
  const written = JSON.parse(backing[KEY]!);
  assert.equal(written.plays[0][0], "audius:new", "the newest play is stored");
  assert.ok(written.plays.length < full.plays.length, "older plays gave up their room");
  assert.deepEqual(log.getPlayLog(), written, "and memory says exactly what storage holds");
});

test("a browser with no room at all keeps the log it already had", async () => {
  const stored = JSON.stringify({
    plays: [["audius:abc", 1_700_000_000_000]],
    songs: { "audius:abc": song("audius:abc") },
  });

  const { log, backing } = await fresh(0, { [KEY]: stored });
  log.logPlay(song("audius:new"), 1_800_000_000_000);

  assert.equal(backing[KEY], stored, "nothing was written");
  // The snapshot has to stay in step with storage, or this tab spends the rest of its life
  // showing counts that no reload will ever see again.
  assert.deepEqual(log.getPlayLog().plays, [["audius:abc", 1_700_000_000_000]]);
});

test("an import that could not be stored reports nothing imported", async () => {
  const { log, backing } = await fresh(0);
  const file = {
    plays: [["audius:abc", 1_700_000_000_000]],
    songs: { "audius:abc": song("audius:abc") },
  };

  assert.equal(log.importPlayLog(file), 0, "the caller prints this number");
  assert.equal(backing[KEY], undefined);
  assert.deepEqual(log.getPlayLog(), { plays: [], songs: {} });
});
