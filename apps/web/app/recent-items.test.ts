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

function labels(items: ReturnType<typeof recentItems>): string[] {
  return items.map((item) => (item.kind === "song" ? item.entry.id : item.artist.name));
}

const weezer = { kind: "artist", name: "Weezer", imageUrl: "https://img/weezer" } as const;
const pixies = { kind: "artist", name: "Pixies", imageUrl: null } as const;

test("songs played from an artist's page fold into one tile for that artist", () => {
  const entries = [played("a", weezer), played("b", weezer), played("c", weezer)];
  assert.deepEqual(recentItems(entries, 12), [{ kind: "artist", artist: weezer, entries }]);
});

test("songs played anywhere else stay songs, and order is kept by the most recent play", () => {
  const history = [played("s1"), played("a", weezer), played("s2"), played("b", weezer), played("c", pixies)];
  assert.deepEqual(labels(recentItems(history, 12)), ["s1", "Weezer", "s2", "Pixies"]);
});

test("the same artist spelled in another case is still one tile", () => {
  const items = recentItems([played("a", weezer), played("b", { ...weezer, name: "WEEZER" })], 12);
  assert.equal(items.length, 1);
});

test("a full row still gathers the artist's older plays for its play button", () => {
  const history = [played("a", weezer), played("s1"), played("s2"), played("old", weezer), played("s3")];
  const items = recentItems(history, 3);
  assert.deepEqual(labels(items), ["Weezer", "s1", "s2"]);
  const [artist] = items;
  assert.ok(artist?.kind === "artist");
  assert.deepEqual(
    artist.entries.map((entry) => entry.id),
    ["a", "old"],
  );
});

test("a malformed stored context is treated as no context rather than trusted", () => {
  const history = [
    played("a", "Weezer"),
    played("b", { kind: "artist", name: "  " }),
    played("c", { kind: "album", name: "x" }),
  ];
  assert.deepEqual(
    recentItems(history, 12).map((item) => item.kind),
    ["song", "song", "song"],
  );
});
