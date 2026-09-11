import assert from "node:assert/strict";
import { test } from "node:test";

import type { PlayedSong } from "./player/history-store";
import { recentItems } from "./recent-items.ts";

function played(id: string, from?: unknown): PlayedSong {
  return {
    id,
    title: `Song ${id}`,
    artists: ["Someone"],
    artworkUrl: null,
    videoId: null,
    ...(from === undefined ? {} : { from: from as PlayedSong["from"] }),
  };
}

const weezer = { kind: "artist", name: "Weezer", imageUrl: "https://img/weezer" } as const;
const pixies = { kind: "artist", name: "Pixies", imageUrl: null } as const;

test("songs played from an artist's page fold into one tile for that artist", () => {
  const items = recentItems([played("a", weezer), played("b", weezer), played("c", weezer)], 12);
  assert.equal(items.length, 1);
  assert.equal(items[0]!.kind, "artist");
  if (items[0]!.kind === "artist") {
    assert.equal(items[0]!.artist.name, "Weezer");
    assert.deepEqual(
      items[0]!.entries.map((entry) => entry.id),
      ["a", "b", "c"],
    );
  }
});

test("songs played anywhere else stay songs, and order is kept by the most recent play", () => {
  const items = recentItems([played("s1"), played("a", weezer), played("s2"), played("b", weezer), played("c", pixies)], 12);
  assert.deepEqual(
    items.map((item) => (item.kind === "song" ? item.entry.id : item.artist.name)),
    ["s1", "Weezer", "s2", "Pixies"],
  );
});

test("the same artist spelled in another case is still one tile", () => {
  const items = recentItems([played("a", weezer), played("b", { ...weezer, name: "WEEZER" })], 12);
  assert.equal(items.length, 1);
});

test("a full row still gathers the artist's older plays for its play button", () => {
  const items = recentItems([played("a", weezer), played("s1"), played("s2"), played("old", weezer), played("s3")], 3);
  assert.equal(items.length, 3);
  const artist = items.find((item) => item.kind === "artist");
  assert.ok(artist && artist.kind === "artist");
  assert.deepEqual(
    artist.entries.map((entry) => entry.id),
    ["a", "old"],
  );
});

test("a malformed stored context is treated as no context rather than trusted", () => {
  const items = recentItems([played("a", "Weezer"), played("b", { kind: "artist", name: "  " }), played("c", { kind: "album", name: "x" })], 12);
  assert.deepEqual(
    items.map((item) => item.kind),
    ["song", "song", "song"],
  );
});
