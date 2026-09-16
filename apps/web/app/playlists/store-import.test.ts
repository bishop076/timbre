/**
 * What an import does to a library that already has one — the two questions `store.test.ts`
 * does not ask: whose playlist a merge is allowed to write into, and what is left behind when
 * the write is refused.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

let instance = 0;

async function fresh(seed?: Record<string, string>, { full = false } = {}) {
  const backing: Record<string, string> = { ...seed };

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
  };

  instance += 1;
  const store = await import(`./store.ts?import-instance=${instance}`);
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
    artworkUrl: null,
    sources: [],
  };
}

function exportFile(playlists: unknown[]) {
  return { format: "timbre.playlists", version: 3, exportedAt: "", playlists };
}

function stored(id: string, name: string, songs: unknown[]) {
  return { id, name, createdAt: "2026-01-01", updatedAt: "2026-01-01", songs };
}

test("somebody else's playlist arrives as its own list, however it is titled", async () => {
  const { store } = await fresh({
    [KEY]: JSON.stringify([stored("mine", "Favourites", [song("a"), song("b")])]),
  });

  store.importPlaylists(
    exportFile([{ id: "theirs", name: "Favourites", songs: [song("x"), song("y")] }]),
  );

  const lists = store.allPlaylists();
  assert.equal(lists.length, 2, "a different id is a different playlist");
  assert.deepEqual(
    lists.find((list: { id: string }) => list.id === "mine")!.songs.map((s: { id: string }) => s.id),
    ["a", "b"],
    "the list you already had is untouched",
  );
  assert.deepEqual(
    lists.find((list: { id: string }) => list.id === "theirs")!.songs.map((s: { id: string }) => s.id),
    ["x", "y"],
  );
});

test("a file carrying no id still merges by name, which is what the fallback is for", async () => {
  const { store } = await fresh({
    [KEY]: JSON.stringify([stored("mine", "Evening", [song("a")])]),
  });

  store.importPlaylists(exportFile([{ name: "evening", songs: [song("a"), song("b")] }]));

  const lists = store.allPlaylists();
  assert.equal(lists.length, 1);
  assert.deepEqual(
    lists[0].songs.map((s: { id: string }) => s.id),
    ["a", "b"],
  );
});

test("a file with no room to land in changes nothing, and says so", async () => {
  const held = [stored("mine", "Evening", [song("a")])];
  const { store, backing } = await fresh({ [KEY]: JSON.stringify(held) }, { full: true });

  // Read it in before the refusal, so there is something to lose.
  store.loadPlaylists();
  assert.equal(store.allPlaylists().length, 1);

  assert.throws(
    () =>
      store.importPlaylists(
        exportFile([
          { id: "mine", name: "Evening", songs: [song("a"), song("b")] },
          { id: "new", name: "Morning", songs: [song("c")] },
        ]),
      ),
    /isn't room in this browser/,
  );

  assert.equal(backing[KEY], JSON.stringify(held), "storage is exactly as it was");
  const lists = store.allPlaylists();
  assert.equal(lists.length, 1, "no half-imported list is left in memory either");
  assert.deepEqual(
    lists[0].songs.map((s: { id: string }) => s.id),
    ["a"],
    "and the merge did not write into the list it matched",
  );
  assert.equal(store.getPlaylistsState().error, null, "the library is not reported as damaged");
});
