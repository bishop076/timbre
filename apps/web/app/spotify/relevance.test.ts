import assert from "node:assert/strict";
import { test } from "node:test";

import type { Song } from "../types";
import { relevantTo } from "./relevance.ts";

function song(title: string, artists: string[], album: string | null = null): Song {
  return {
    id: `spotify:${title}`,
    title,
    artists,
    album,
    durationMs: null,
    isrc: null,
    artworkUrl: null,
    sources: [],
  };
}

const titles = (songs: readonly Song[]) => songs.map((found) => found.title);

test("a query nothing was found for keeps nothing from Spotify either", () => {
  // What Spotify actually answers a nonsense query with: five real songs, none of them asked
  // for. The page said "Nothing found" and then drew these underneath it.
  const catalogue = [
    song("Espresso", ["Sabrina Carpenter"]),
    song("Birds of a Feather", ["Billie Eilish"]),
    song("Good Luck, Babe!", ["Chappell Roan"]),
  ];

  assert.deepEqual(relevantTo("qwkjehrqwe", catalogue), []);
});

test("a word shared with the query is enough, wherever it sits", () => {
  const catalogue = [
    song("Creep", ["Radiohead"], "Pablo Honey"),
    song("Karma Police", ["Radiohead"], "OK Computer"),
    song("Creepin'", ["Metro Boomin"], "Heroes & Villains"),
    song("Espresso", ["Sabrina Carpenter"]),
  ];

  assert.deepEqual(titles(relevantTo("creep radiohead", catalogue)), [
    "Creep",
    "Karma Police",
    "Creepin'",
  ]);
  assert.deepEqual(titles(relevantTo("pablo honey", catalogue)), ["Creep"]);
  assert.deepEqual(titles(relevantTo("Sabrina Carpenter", catalogue)), ["Espresso"]);
});

test("a query still being typed does not empty the section between keystrokes", () => {
  const catalogue = [song("Karma Police", ["Radiohead"])];

  assert.deepEqual(titles(relevantTo("radioh", catalogue)), ["Karma Police"]);
  assert.deepEqual(titles(relevantTo("kar", catalogue)), ["Karma Police"]);
  // Two letters are not a prefix anybody means: "ka" would keep half a catalogue.
  assert.deepEqual(relevantTo("ka", catalogue), []);
});

test("accents and punctuation are not a difference", () => {
  const catalogue = [song("Déjà Vu", ["Olivia Rodrigo"]), song("good 4 u", ["Olivia Rodrigo"])];

  assert.deepEqual(titles(relevantTo("deja vu", catalogue)), ["Déjà Vu"]);
  assert.deepEqual(titles(relevantTo("good 4 u", catalogue)), ["good 4 u"]);
});

test("a query with no words to compare drops nothing", () => {
  const catalogue = [song("Espresso", ["Sabrina Carpenter"])];

  // Punctuation alone is no basis for saying a result is unrelated.
  assert.deepEqual(titles(relevantTo("???", catalogue)), ["Espresso"]);
  assert.deepEqual(relevantTo("anything", []), []);
});
