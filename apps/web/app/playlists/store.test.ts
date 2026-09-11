import assert from "node:assert/strict";
import { test } from "node:test";

let instance = 0;

async function fresh(seed?: Record<string, string>) {
  const backing: Record<string, string> = { ...seed };

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
  };

  instance += 1;
  const store = await import(`./store.ts?instance=${instance}`);
  return { store, backing };
}

const KEY = "timbre:playlists";

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

test("an import keeps well-formed songs, drops hostile ones, and persists", async () => {
  const { store, backing } = await fresh();
  const hostile = [null, undefined, { id: "x", title: "t", artists: "not an array", sources: [] }];

  const added = store.importPlaylists(
    exportFile([{ name: "mixed", songs: [...hostile, song("bbbbbbbbbbb")] }]),
  );

  assert.equal(added, 1);
  const [stored] = JSON.parse(backing[KEY]!);
  assert.equal(stored.name, "mixed");
  assert.deepEqual(stored.songs, [song("bbbbbbbbbbb")]);
  assert.deepEqual(store.exportPlaylists().playlists[0].songs, [song("bbbbbbbbbbb")]);
});

test("a browser already poisoned by a bad import heals on the next read", async () => {
  const poisoned = JSON.stringify([
    { id: "p1", name: "pwn", createdAt: "", updatedAt: "", songs: [null, song("aaaaaaaaaaa")] },
  ]);

  const { store } = await fresh({ [KEY]: poisoned });

  assert.doesNotThrow(() => store.loadPlaylists());
  assert.equal(store.exportPlaylists().playlists[0].songs.length, 1);
});

test("a non-string createdAt cannot reach the sort", async () => {
  const { store } = await fresh();

  store.importPlaylists(
    exportFile([{ name: "odd", createdAt: { nope: true }, songs: [song("ddddddddddd")] }]),
  );

  const [only] = store.exportPlaylists().playlists;
  assert.equal(typeof only!.createdAt, "string");
});

test("a file that is not an export is refused by name", async () => {
  const { store } = await fresh();

  const notAnExport = /isn't a Timbre playlist export/;
  assert.throws(() => store.importPlaylists({ format: "something.else" }), notAnExport);
  assert.throws(() => store.importPlaylists(null), notAnExport);
  assert.throws(() => store.importPlaylists(exportFile([])), /no playlists in it/);
});

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
  assert.equal(one.updatedAt, "2026-01-02");

  assert.equal(store.addSourcesToSong("a", [audius]), 0);
});

test("a backup carries liked songs, and a file holding only those still imports", async () => {
  const { store } = await fresh();
  const file = store.exportPlaylists({ liked: [song("l")] });
  assert.equal(file.version, 2);
  assert.equal(file.liked.length, 1);
  assert.equal("liked" in store.exportPlaylists({ liked: [] }), false);

  assert.equal(store.importPlaylists({ ...exportFile([]), liked: [song("l")] }), 0);
  assert.throws(() => store.importPlaylists({ ...exportFile([]), liked: [] }), /no playlists/);
});

test("a write before any read keeps the playlists already saved", async () => {
  const saved = { id: "p1", name: "Kept", createdAt: "2026-01-01", updatedAt: "2026-01-01", songs: [song("a")] };
  const { store, backing } = await fresh({ [KEY]: JSON.stringify([saved]) });

  const created = store.createPlaylist("New");
  store.addSongsToPlaylist(created.id, [song("b"), song("c")]);

  const lists = JSON.parse(backing[KEY]!);
  assert.deepEqual(lists.map((list: { name: string }) => list.name).sort(), ["Kept", "New"]);
  assert.equal(lists.find((list: { name: string }) => list.name === "New").songs.length, 2);
});
