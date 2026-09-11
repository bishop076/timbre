import assert from "node:assert/strict";
import { test } from "node:test";

import type { Song } from "../types";
import { insertAfter, moveWithin, removeAt } from "./queue-ops.ts";

function song(id: string): Song {
  return {
    id,
    title: id,
    artists: [],
    album: null,
    durationMs: null,
    isrc: null,
    artworkUrl: null,
    sources: [],
  };
}

const ids = (songs: Song[]) => songs.map((entry) => entry.id).join("");
const queue = ["a", "b", "c", "d", "e"].map(song);
const index = 2;

test("removing a song off the playhead keeps the same song playing", () => {
  for (const [position, left] of [
    [4, "abcd"],
    [0, "bcde"],
  ] as const) {
    const edit = removeAt(queue, index, position)!;
    assert.equal(ids(edit.queue), left);
    assert.equal(edit.queue[edit.index]!.id, "c");
    assert.equal(edit.play, null, "nothing new to load — the same song keeps playing");
  }
});

test("removing the playing song steps onto the one that follows it", () => {
  const edit = removeAt(queue, index, 2)!;

  assert.equal(ids(edit.queue), "abde");
  assert.equal(edit.queue[edit.index]!.id, "d");
  assert.equal(edit.play?.id, "d", "a different song now plays, so it must be loaded");
});

test("removing the playing song when it is last falls back to the new last", () => {
  const edit = removeAt(["a", "b"].map(song), 1, 1)!;

  assert.equal(ids(edit.queue), "a");
  assert.equal(edit.index, 0, "must not point past the end of the list");
  assert.equal(edit.play?.id, "a");
});

test("removing the only song empties the queue and loads nothing", () => {
  const edit = removeAt([song("a")], 0, 0)!;

  assert.equal(edit.queue.length, 0);
  assert.equal(edit.index, 0);
  assert.equal(edit.play, null);
});

test("removing a position that does not exist is a no-op", () => {
  assert.equal(removeAt(queue, index, 9), null);
  assert.equal(removeAt([], 0, 0), null);
});

test("moves reorder the list and keep the playhead on the playing song", () => {
  for (const [from, to, order] of [
    [2, 0, "cabde"],
    [0, 4, "bcdea"],
    [4, 0, "eabcd"],
    [3, 4, "abced"],
  ] as const) {
    const edit = moveWithin(queue, index, from, to)!;
    assert.equal(ids(edit.queue), order, `${from}->${to}`);
    assert.equal(edit.queue[edit.index]!.id, "c", `${from}->${to}`);
  }
});

test("moves that change nothing or land outside the list are no-ops", () => {
  assert.equal(moveWithin(queue, index, 1, 1), null);
  assert.equal(moveWithin(queue, index, 1, -1), null);
  assert.equal(moveWithin(queue, index, 1, 5), null);
  assert.equal(moveWithin(queue, index, 9, 0), null);
});

test("the song under the playhead survives every single-step move", () => {
  for (let playhead = 0; playhead < 5; playhead += 1) {
    for (let from = 0; from < 5; from += 1) {
      for (let to = 0; to < 5; to += 1) {
        const edit = moveWithin(queue, playhead, from, to);
        if (!edit) continue;
        assert.equal(
          edit.queue[edit.index]!.id,
          queue[playhead]!.id,
          `moving ${from}->${to} while playing at ${playhead} lost the song`,
        );
      }
    }
  }
});

test("play next lands songs directly after the playing one, in order", () => {
  const edit = insertAfter(queue, index, [song("x"), song("y")])!;

  assert.equal(ids(edit.queue), "abcxyde");
  assert.equal(edit.index, index, "the playhead does not move");
  assert.equal(edit.queue[edit.index]!.id, "c", "and still points at what is audible");
  assert.equal(edit.play, null, "nothing reloads — the current song keeps playing");
});

test("play next on an empty queue starts playing, since there is no after", () => {
  const edit = insertAfter([], 0, [song("x"), song("y")])!;

  assert.equal(ids(edit.queue), "xy");
  assert.equal(edit.index, 0);
  assert.equal(edit.play!.id, "x", "or the songs arrive and sit there in silence");
});

test("play next at the end of the queue appends", () => {
  const edit = insertAfter(["a", "b", "c"].map(song), 2, [song("x")])!;

  assert.equal(ids(edit.queue), "abcx");
  assert.equal(edit.index, 2);
});

test("play next with nothing to add is a no-op", () => {
  assert.equal(insertAfter(queue, index, []), null);
});
