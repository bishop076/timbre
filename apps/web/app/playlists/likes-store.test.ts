import assert from "node:assert/strict";
import { test } from "node:test";

import { sameTrack } from "../player/song-match.ts";

const KEY = "timbre:likes";

let instance = 0;

async function fresh(seed: Record<string, string> = {}, { full = false } = {}) {
  const backing = { ...seed };

  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => backing[key] ?? null,
      setItem: (key: string, value: string) => {
        if (full) throw new Error("QuotaExceededError");
        backing[key] = value;
      },
      removeItem: (key: string) => {
        delete backing[key];
      },
    },
    addEventListener() {},
    removeEventListener() {},
  };

  instance += 1;
  const likes = await import(`./likes-store.ts?instance=${instance}`);
  return { likes, backing };
}

function song(id: string, title = `Track ${id}`, extra: Record<string, unknown> = {}) {
  return {
    id,
    title,
    artists: ["NIKI"],
    album: null,
    durationMs: 1000,
    isrc: null,
    artworkUrl: null,
    sources: [],
    ...extra,
  };
}

const ids = (songs: { id: string }[]) => songs.map((entry) => entry.id);

const stored = (backing: Record<string, string>) =>
  JSON.parse(backing[KEY]!) as { id: string; from?: unknown }[];

test("likes are stored newest first, without the page they were played from", async () => {
  const { likes, backing } = await fresh();

  likes.likeSong(song("a", "First", { from: { kind: "artist", name: "NIKI" } }));
  likes.likeSong(song("b", "Second"));

  assert.deepEqual(ids(stored(backing)), ["b", "a"]);
  assert.equal(stored(backing)[1]!.from, undefined);
  assert.equal(likes.getLikesState().error, null);
});

test("the same recording under another id is one like, and unliking it clears it", async () => {
  const { likes } = await fresh();

  likes.likeSong(song("key#ytmusic:one", "Take Care"));
  likes.likeSong(song("key#ytmusic:two", "Take Care (Official Video)"));
  assert.equal(likes.getLikedSongs().length, 1);

  likes.unlikeSong(song("key#ytmusic:two", "Take Care (Official Video)"));
  assert.equal(likes.getLikedSongs().length, 0);
});

test("a different recording is a different like", async () => {
  const { likes } = await fresh();

  likes.likeSong(song("a", "Take Care"));
  likes.likeSong(song("b", "Take Care (Acoustic)"));
  likes.likeSong({ ...song("c", "Take Care"), artists: ["Drake"] });

  assert.equal(likes.getLikedSongs().length, 3);
});

test("a shared ISRC is the same recording whatever the titles say", async () => {
  const { likes } = await fresh();

  likes.likeSong(song("a", "Every Summertime", { isrc: "USRC12100001" }));

  const liked = likes.getLikedSongs();
  assert.equal(likes.isLikedIn(liked, song("b", "EVERY SUMMERTIME (Live)", { isrc: "USRC12100001" })), true);
  assert.equal(likes.isLikedIn(liked, song("c", "Every Summertime", { isrc: "GBAYE0000001" })), false);
});

test("the index never answers differently from asking sameTrack of every entry", async () => {
  const { likes } = await fresh();

  const pool = [
    song("same-id", "One Title"),
    song("same-id", "Another Title Entirely"),
    song("a", "Lowkey", { isrc: "USRC1" }),
    song("b", "Lowkey (Official Video)", { isrc: "USRC2" }),
    song("c", "Lowkey (Official Video)"),
    song("d", "Lowkey (Live)"),
    song("e", "Lowkey (feat. 88rising)"),
    { ...song("f", "Lowkey"), artists: [] },
    { ...song("g", "Lowkey"), artists: ["Someone Else"] },
    song("h", "!!!"),
    song("i", "!!!"),
  ];

  for (const left of pool) {
    for (const right of pool) {
      assert.equal(
        likes.isLikedIn([left], right),
        sameTrack(left, right),
        `${left.id} "${left.title}" against ${right.id} "${right.title}"`,
      );
    }
  }
});

test("a broken stored entry heals on read, and a like starts from what is stored", async () => {
  const { likes, backing } = await fresh({ [KEY]: JSON.stringify([null, { id: "x" }, song("old")]) });

  assert.deepEqual(ids(likes.getLikedSongs()), ["old"]);

  likes.likeSong(song("new"));
  assert.deepEqual(ids(stored(backing)), ["new", "old"]);
});

test("running out of storage is reported, and the like still holds for the session", async () => {
  const { likes } = await fresh(undefined, { full: true });

  likes.likeSong(song("a"));

  const state = likes.getLikesState();
  assert.match(state.error ?? "", /Out of browser storage/);
  assert.equal(state.songs.length, 1);
});

test("an import adds only what is new, after what is here, in the file's order", async () => {
  const { likes } = await fresh();

  likes.likeSong(song("mine", "Mine"));

  const added = likes.importLikedSongs([
    null,
    song("x", "Imported One"),
    song("mine-elsewhere", "Mine (Official Audio)"),
    song("y", "Imported Two"),
    song("x-again", "Imported One"),
    { id: "broken", title: "no arrays" },
  ]);

  assert.equal(added, 2);
  assert.deepEqual(ids(likes.getLikedSongs()), ["mine", "x", "y"]);
});

test("an import of something that is not a list adds nothing", async () => {
  const { likes, backing } = await fresh();

  assert.equal(likes.importLikedSongs({ format: "timbre.playlists" }), 0);
  assert.equal(backing[KEY], undefined);
});
