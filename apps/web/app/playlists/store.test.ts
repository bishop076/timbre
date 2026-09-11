import assert from "node:assert/strict";
import { test } from "node:test";

/*
 * The store keeps module-level state and reads storage exactly once, so each test gets its
 * own copy of the module. A query string is the only way to defeat the ESM cache; it has to
 * differ per test, hence the counter.
 */
let instance = 0;

interface Storage {
  [key: string]: string;
}

async function fresh(seed?: Storage) {
  const backing: Storage = { ...seed };

  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => backing[key] ?? null,
      setItem: (key: string, value: string) => {
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
  const store = await import(`./store.ts?instance=${instance}`);
  return { store, backing };
}

const KEY = "timbre:playlists";

/** A song with every field the app dereferences without a guard. */
function song(id: string) {
  return {
    id,
    title: `Track ${id}`,
    artists: ["Bicep"],
    album: null,
    durationMs: 1000,
    isrc: null,
    artworkUrl: `https://i.ytimg.com/vi/${id}/hq.jpg`,
    sources: [],
  };
}

function exportFile(playlists: unknown[]) {
  return { format: "timbre.playlists", version: 1, exportedAt: "", playlists };
}

// docs/SECURITY.md S-1. The payload is the one that took down every route.

test("an imported song that is null is dropped rather than saved", async () => {
  const { store, backing } = await fresh();

  const added = store.importPlaylists(exportFile([{ name: "pwn", songs: [null] }]));

  assert.equal(added, 1);
  // The playlist survives; only the unusable entry is gone.
  const parsed = JSON.parse(backing[KEY]!);
  assert.equal(parsed[0].name, "pwn");
  assert.deepEqual(parsed[0].songs, []);
});

test("a browser already poisoned by that file heals on the next read", async () => {
  // Written by a Timbre from before the check existed — this is what an affected browser
  // is holding right now, and it must not keep throwing forever.
  const poisoned = JSON.stringify([
    { id: "p1", name: "pwn", createdAt: "", updatedAt: "", songs: [null, song("aaaaaaaaaaa")] },
  ]);

  const { store } = await fresh({ [KEY]: poisoned });

  assert.doesNotThrow(() => store.loadPlaylists());
});

test("every shape that used to throw is refused", async () => {
  const { store } = await fresh();

  // `null` was the one that threw; the rest would throw a field or two later, in the
  // player or a row, which is worse to diagnose.
  const hostile = [null, undefined, { id: "x", title: "t", artists: "not an array", sources: [] }];

  store.importPlaylists(exportFile([{ name: "mixed", songs: [...hostile, song("bbbbbbbbbbb")] }]));

  const [only] = store.exportPlaylists().playlists;
  assert.equal(only!.songs.length, 1);
  assert.equal(only!.songs[0]!.id, "bbbbbbbbbbb");
});

test("a well-formed export round-trips unchanged", async () => {
  const { store } = await fresh();

  store.importPlaylists(exportFile([{ name: "keeps", songs: [song("ccccccccccc")] }]));

  const [only] = store.exportPlaylists().playlists;
  assert.equal(only!.songs.length, 1);
  assert.equal(only!.songs[0]!.title, "Track ccccccccccc");
});

test("a non-string createdAt cannot reach the sort", async () => {
  const { store } = await fresh();

  // `createdAt: playlist.createdAt ?? now` used to pass this straight through, and
  // `state` sorts timestamps with localeCompare.
  store.importPlaylists(
    exportFile([{ name: "odd", createdAt: { nope: true }, songs: [song("ddddddddddd")] }]),
  );

  const [only] = store.exportPlaylists().playlists;
  assert.equal(typeof only!.createdAt, "string");
});

test("a file that is not an export is refused by name", async () => {
  const { store } = await fresh();

  assert.throws(() => store.importPlaylists({ format: "something.else" }), store.ImportError);
  assert.throws(() => store.importPlaylists(null), store.ImportError);
  assert.throws(() => store.importPlaylists(exportFile([])), store.ImportError);
});

// The rescue's copies join a saved song rather than replacing what it had: a VPN that walls
// YouTube for one afternoon must not strip YouTube from a list for good.
test("a rescued song gains the copies that played, beside the ones it had", async () => {
  const youtube = { source: "ytmusic", sourceId: "y1", url: null, playback: "queue" };
  const saved = { ...song("a"), sources: [youtube] };
  const { store, backing } = await fresh({
    [KEY]: JSON.stringify([
      { id: "p1", name: "One", createdAt: "2026-01-01", updatedAt: "2026-01-02", songs: [saved, song("b")] },
      { id: "p2", name: "Two", createdAt: "2026-01-01", updatedAt: "2026-01-03", songs: [song("c")] },
    ]),
  });

  const audius = { source: "audius", sourceId: "9", url: null, playback: "queue" };
  assert.equal(store.addSourcesToSong("a", [youtube, audius]), 1);

  const [one, two] = JSON.parse(backing[KEY]!);
  assert.deepEqual(one.songs[0].sources, [youtube, audius]);
  assert.deepEqual(one.songs[1].sources, []);
  assert.deepEqual(two.songs[0].sources, []);
  // Not an edit the reader made, so the library keeps its order.
  assert.equal(one.updatedAt, "2026-01-02");

  // Nothing new the second time round, so nothing is written.
  assert.equal(store.addSourcesToSong("a", [audius]), 0);
});
