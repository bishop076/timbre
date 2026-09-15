import assert from "node:assert/strict";
import { test } from "node:test";

import { listeningStats, playsFrom } from "../stats/listening-stats.ts";
// Imported without a query, so this is the one shared instance every `fresh()` module writes
// into. The counting tests read it as a delta for that reason.
import { EMPTY_LOG, getPlayLog } from "../stats/play-log.ts";

const KEY = "timbre:history";
const CID = "baeaaaiqsecd464n7qxtqqo67upgngf2fcajvoo34d77qqipyxnu2vpqazrwom";

let instance = 0;

async function freshWith(
  seed: Record<string, string>,
  setItem?: (key: string, value: string) => void,
) {
  const backing: Record<string, string | undefined> = { ...seed };

  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => backing[key] ?? null,
      setItem:
        setItem ??
        ((key: string, value: string) => {
          backing[key] = value;
        }),
      removeItem: (key: string) => {
        delete backing[key];
      },
    },
    addEventListener() {},
    removeEventListener() {},
  };

  instance += 1;
  const loaded = (await import(
    `./history-store.ts?instance=${instance}`
  )) as typeof import("./history-store.ts");

  return { history: loaded, store: backing };
}

async function fresh(seed: Record<string, string> = {}) {
  return (await freshWith(seed)).history;
}

const entry = (artworkUrl: string | null) => ({
  id: "audius:abc",
  title: "Delilah",
  artists: ["Someone"],
  artworkUrl,
  videoId: null,
});

test("a cover already stored on a third-party host is not drawn from it again", async () => {
  // Written before the Audius rewrite existed, so it names a community content node.
  const stale = entry(`https://audius-creator-7.theblueprint.xyz/content/${CID}/480x480.jpg`);
  const history = await fresh({ [KEY]: JSON.stringify([stale]) });

  const [read] = history.getHistorySnapshot();
  assert.equal(read?.artworkUrl, `https://api.audius.co/content/${CID}/480x480.jpg`);
});

test("a cover on a host the proxy never serves is dropped, and the song kept", async () => {
  const planted = entry("https://evil.example/beacon.png");
  const history = await fresh({ [KEY]: JSON.stringify([planted]) });

  const [read] = history.getHistorySnapshot();
  assert.equal(read?.title, "Delilah");
  assert.equal(read?.artworkUrl, null);
});

test("a cover the proxy does serve is left exactly as it was", async () => {
  const good = entry("https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg");
  const history = await fresh({ [KEY]: JSON.stringify([good]) });

  assert.equal(
    history.getHistorySnapshot()[0]?.artworkUrl,
    "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg",
  );
});

/* ---------------------------------------------------------------------------
   The bounds, and what happens when the browser will not take a write.
   --------------------------------------------------------------------------- */

const played = (id: string, title = `Song ${id}`) => ({
  id,
  title,
  artists: ["Someone"],
  artworkUrl: null,
  videoId: null,
});

test("a stored list longer than the limit is cut on the way in, not only on the way out", async () => {
  // Written by an older build with a larger cap, or merged by a second tab. `recordPlay` would
  // have trimmed it on the next play; until then every reader — the home shelves, the taste
  // book, the stats page — worked on all four hundred.
  const many = Array.from({ length: 400 }, (_, index) => played(`s${index}`));
  const history = await fresh({ [KEY]: JSON.stringify(many) });

  assert.equal(history.getHistorySnapshot().length, 50);
  assert.equal(history.getHistorySnapshot()[0]?.id, "s0");
});

test("the same song stored twice comes back once, so a repeat cannot inflate a count", async () => {
  // `playsFrom` turns every history entry the log has not seen into its own undated play, so a
  // duplicated entry is a play of a song that never happened.
  const copies = [played("a"), played("b"), played("a"), played("a")];
  const history = await fresh({ [KEY]: JSON.stringify(copies) });

  const snapshot = history.getHistorySnapshot();
  assert.deepEqual(
    snapshot.map((song) => song.id),
    ["a", "b"],
  );

  const stats = listeningStats(playsFrom(EMPTY_LOG, snapshot));
  assert.equal(stats.total, 2);
  assert.deepEqual(
    stats.songs.map((song) => [song.song.id, song.plays]),
    [
      ["a", 1],
      ["b", 1],
    ],
  );
});

test("one play is one logged play, even when it is recorded twice", async () => {
  const history = await fresh();
  const before = getPlayLog().plays.length;

  const song = { ...played("a"), source: "audius", sourceId: "1" };
  history.recordPlay(song);
  history.recordPlay(song);

  assert.equal(history.getHistorySnapshot().length, 1);
  assert.equal(getPlayLog().plays.length - before, 1);
});

test("a second source for the same song is a second play", async () => {
  const history = await fresh();
  const before = getPlayLog().plays.length;

  history.recordPlay({ ...played("a"), source: "ytmusic", sourceId: "1" });
  history.recordPlay({ ...played("a"), source: "soundcloud", sourceId: "2" });

  assert.equal(getPlayLog().plays.length - before, 2);
});

test("a browser that will not take the write keeps playing", async () => {
  // Every localStorage quota is finite and some browsers give a private window almost none, so
  // `setItem` throwing is a state this app has to be able to be in — not a crash on the next
  // song. The listener loses the record when the tab closes; nothing else changes.
  const refused = () => {
    const error = new Error("exceeded the quota");
    error.name = "QuotaExceededError";
    throw error;
  };
  const { history, store } = await freshWith({}, refused);

  history.recordPlay(played("a"));
  history.recordPlay(played("b"));

  assert.deepEqual(
    history.getHistorySnapshot().map((song) => song.id),
    ["b", "a"],
  );
  assert.equal(store[KEY], undefined);
});
