import assert from "node:assert/strict";
import { test } from "node:test";

import type { Song } from "../types";
import { moveWithin, removeAt } from "./queue-ops.ts";

/** Only the id matters here; the rest is shape the functions never read. */
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

/** a b c d e, playing "c". */
function fixture() {
  return { queue: ["a", "b", "c", "d", "e"].map(song), index: 2 };
}

test("removing a song ahead of the playhead leaves playback alone", () => {
  const { queue, index } = fixture();
  const edit = removeAt(queue, index, 4)!;

  assert.equal(ids(edit.queue), "abcd");
  assert.equal(edit.queue[edit.index]!.id, "c");
  assert.equal(edit.play, null, "nothing new to load — the same song keeps playing");
});

test("removing a song behind the playhead keeps the same song playing", () => {
  const { queue, index } = fixture();
  const edit = removeAt(queue, index, 0)!;

  assert.equal(ids(edit.queue), "bcde");
  // The index has to shift down with the list, or playback silently jumps.
  assert.equal(edit.index, 1);
  assert.equal(edit.queue[edit.index]!.id, "c");
  assert.equal(edit.play, null);
});

test("removing the playing song steps onto the one that follows it", () => {
  const { queue, index } = fixture();
  const edit = removeAt(queue, index, 2)!;

  assert.equal(ids(edit.queue), "abde");
  assert.equal(edit.queue[edit.index]!.id, "d");
  assert.equal(edit.play?.id, "d", "a different song now plays, so it must be loaded");
  assert.equal(edit.stopped, false);
});

test("removing the playing song when it is last falls back to the new last", () => {
  const queue = ["a", "b"].map(song);
  const edit = removeAt(queue, 1, 1)!;

  assert.equal(ids(edit.queue), "a");
  assert.equal(edit.index, 0, "must not point past the end of the list");
  assert.equal(edit.play?.id, "a");
});

test("removing the only song stops playback", () => {
  const edit = removeAt([song("a")], 0, 0)!;

  assert.equal(edit.queue.length, 0);
  assert.equal(edit.stopped, true);
  assert.equal(edit.play, null);
});

test("removing a position that does not exist is a no-op", () => {
  const { queue, index } = fixture();
  assert.equal(removeAt(queue, index, 9), null);
  assert.equal(removeAt([], 0, 0), null);
});

test("moving the playing song carries playback with it", () => {
  const { queue, index } = fixture();
  const edit = moveWithin(queue, index, 2, 0)!;

  assert.equal(ids(edit.queue), "cabde");
  assert.equal(edit.index, 0);
  assert.equal(edit.queue[edit.index]!.id, "c");
});

test("moving a song across the playhead from below shifts it back", () => {
  const { queue, index } = fixture();
  // "a" (behind) jumps to the end (ahead), so everything between slides down.
  const edit = moveWithin(queue, index, 0, 4)!;

  assert.equal(ids(edit.queue), "bcdea");
  assert.equal(edit.queue[edit.index]!.id, "c", "still playing the same song");
});

test("moving a song across the playhead from above shifts it forward", () => {
  const { queue, index } = fixture();
  const edit = moveWithin(queue, index, 4, 0)!;

  assert.equal(ids(edit.queue), "eabcd");
  assert.equal(edit.queue[edit.index]!.id, "c");
});

test("a one-step nudge moves exactly one place", () => {
  const { queue, index } = fixture();
  const edit = moveWithin(queue, index, 3, 4)!;

  // `to` counts against the list minus the moved song, which is what stops
  // "down by one" collapsing into a no-op.
  assert.equal(ids(edit.queue), "abced");
  assert.equal(edit.queue[edit.index]!.id, "c");
});

test("moves that change nothing or land outside the list are no-ops", () => {
  const { queue, index } = fixture();
  assert.equal(moveWithin(queue, index, 1, 1), null);
  assert.equal(moveWithin(queue, index, 1, -1), null);
  assert.equal(moveWithin(queue, index, 1, 5), null);
  assert.equal(moveWithin(queue, index, 9, 0), null);
});

test("the song under the playhead survives every single-step move", () => {
  // The invariant the index arithmetic exists to preserve, checked exhaustively
  // rather than at the few points a hand-written case would reach.
  for (let index = 0; index < 5; index += 1) {
    for (let from = 0; from < 5; from += 1) {
      for (let to = 0; to < 5; to += 1) {
        const queue = ["a", "b", "c", "d", "e"].map(song);
        const playing = queue[index]!.id;
        const edit = moveWithin(queue, index, from, to);
        if (!edit) continue;

        assert.equal(
          edit.queue[edit.index]!.id,
          playing,
          `moving ${from}->${to} while playing ${playing} at ${index} lost the song`,
        );
      }
    }
  }
});
