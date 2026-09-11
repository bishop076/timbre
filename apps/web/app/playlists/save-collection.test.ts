import assert from "node:assert/strict";
import { test } from "node:test";

import type { Song } from "../types";

/*
 * The store reads storage once per module instance, and `save-collection.ts` imports it
 * statically, so the stub has to exist before the first import and every test shares one
 * library. Each test below names its own playlist and looks only at that one.
 */
const KEY = "timbre:playlists";
const backing: Record<string, string> = {
  [KEY]: JSON.stringify([
    {
      id: "already-here",
      name: "Already here",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      songs: [],
    },
  ]),
};

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

const { saveAsPlaylist, songsToSave } = await import("./save-collection.ts");

function stored(): { id: string; name: string; songs: Record<string, unknown>[] }[] {
  return JSON.parse(backing[KEY]!);
}

/** A collection row: a song plus the chart fields the page adds. */
function row(id: string, extra: Record<string, unknown> = {}): Song {
  return {
    id,
    title: `Track ${id}`,
    artists: ["Daft Punk"],
    album: "Discovery",
    durationMs: 321_000,
    isrc: null,
    artworkUrl: null,
    sources: [{ source: "ytmusic", sourceId: id, url: null, playback: "queue" }],
    ...extra,
  } as Song;
}

test("saves every song, in order, under the collection's name", () => {
  const result = saveAsPlaylist("Discovery", [row("a"), row("b"), row("c")]);
  assert.ok(result);
  assert.equal(result.saved, 3);
  assert.equal(result.playlist.name, "Discovery");

  const saved = stored().find((playlist) => playlist.id === result.playlist.id);
  assert.deepEqual(
    saved?.songs.map((song) => song.id),
    ["a", "b", "c"],
  );
});

test("keeps the playlists already saved", () => {
  // The store fills its list lazily and writes it back whole; saved before anything read it,
  // the new playlist would have been the only one left.
  saveAsPlaylist("Another", [row("d")]);
  assert.ok(stored().some((playlist) => playlist.id === "already-here"));
});

test("stores songs without the page's chart fields or where they were played from", () => {
  const result = saveAsPlaylist("Stripped", [
    row("e", { position: 4, popularity: 912_000, from: { kind: "artist", name: "Daft Punk", imageUrl: null } }),
  ]);
  const [song] = stored().find((playlist) => playlist.id === result!.playlist.id)!.songs;
  assert.equal(song!.id, "e");
  assert.ok(!("position" in song!));
  assert.ok(!("popularity" in song!));
  assert.ok(!("from" in song!));
});

test("nothing to save leaves no empty playlist behind", () => {
  const before = stored().length;
  assert.equal(saveAsPlaylist("Empty", []), null);
  assert.equal(saveAsPlaylist("Sourceless", [row("f", { sources: [] })]), null);
  assert.equal(stored().length, before);
});

test("a song with no source, or not shaped like one, is left out", () => {
  const kept = songsToSave([
    row("g"),
    row("h", { sources: [] }),
    null as unknown as Song,
    { id: "i", title: "No artists" } as unknown as Song,
  ]);
  assert.deepEqual(
    kept.map((song) => song.id),
    ["g"],
  );
});

test("link-only songs are kept — the player finds a copy for them later", () => {
  const deezer = row("j", { sources: [{ source: "deezer", sourceId: "1", url: "https://www.deezer.com/track/1", playback: "link" }] });
  assert.equal(songsToSave([deezer]).length, 1);
});

test("an overlong name is cut to what the store's own field accepts", () => {
  const result = saveAsPlaylist(`  ${"x".repeat(300)}  `, [row("k")]);
  assert.equal(result!.playlist.name.length, 120);
});
