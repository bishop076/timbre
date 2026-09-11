import assert from "node:assert/strict";
import { test } from "node:test";

import type { Song } from "../types";
import {
  asking,
  initialModel,
  leaving,
  localSong,
  localState,
  newer,
  owns,
  parseMessage,
  PING_AFTER_MS,
  receive,
  STALE_AFTER_MS,
  tick,
  wire,
  type Local,
  type Message,
  type OwnerReport,
  type SyncModel,
} from "./tab-sync.ts";

const IDLE: Local = { state: "idle", loaded: false };
const PLAYING: Local = { state: "playing", loaded: true };
const PAUSED: Local = { state: "paused", loaded: true };
const LOADING: Local = { state: "loading", loaded: true };

function song(id: string): Song {
  return {
    id,
    title: id,
    artists: ["someone"],
    album: null,
    durationMs: null,
    isrc: null,
    artworkUrl: null,
    sources: [{ source: "audius", sourceId: id, url: null, playback: "queue" }],
  };
}

function report(overrides: Partial<OwnerReport> = {}): OwnerReport {
  return {
    song: { id: "s", title: "Song", artists: ["Artist"], artworkUrl: null },
    state: "playing",
    position: 12,
    duration: 200,
    hasNext: true,
    hasPrevious: false,
    ...overrides,
  };
}

/** A tab that has claimed at `at`, as its own model sees it. */
function owner(self: string, at: number): SyncModel {
  return localState(initialModel(self), "playing", at).model;
}

// ---------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------

test("a well-formed message survives the wire", () => {
  const message: Message = { type: "state", from: "a", at: 5, report: report() };
  assert.deepEqual(parseMessage(wire(message)), message);
});

test("anything that is not this protocol's message is dropped", () => {
  for (const junk of [null, 1, "claim", [], {}, { type: "claim", from: "a", at: 1 }]) {
    assert.equal(parseMessage(junk), null, JSON.stringify(junk));
  }
  // Another build's protocol version, however plausible the rest of it looks.
  assert.equal(parseMessage({ v: 2, type: "hello", from: "a" }), null);
  assert.equal(parseMessage({ v: 1, type: "hello", from: "" }), null);
  assert.equal(parseMessage({ v: 1, type: "claim", from: "a", at: Number.NaN }), null);
  assert.equal(parseMessage({ v: 1, type: "shout", from: "a" }), null);
});

test("a report with a bad field is refused rather than half-read", () => {
  const bad = [
    { ...report(), state: "exploded" },
    { ...report(), position: -1 },
    { ...report(), duration: Number.POSITIVE_INFINITY },
    { ...report(), hasNext: "yes" },
    { ...report(), song: { id: "s", title: "t", artists: [1] } },
  ];
  for (const value of bad) {
    assert.equal(parseMessage({ v: 1, type: "state", from: "a", at: 1, report: value }), null);
  }
});

test("artwork that is not a web address is not drawn", () => {
  const parsed = parseMessage(
    wire({
      type: "state",
      from: "a",
      at: 1,
      report: report({ song: { id: "s", title: "t", artists: [], artworkUrl: "javascript:alert(1)" } }),
    }),
  );
  assert.equal(parsed?.type === "state" && parsed.report.song.artworkUrl, null);
});

test("commands are checked, seek included", () => {
  const command = (value: unknown) => parseMessage({ v: 1, type: "command", from: "a", to: "b", command: value });
  assert.ok(command({ action: "toggle" }));
  assert.ok(command({ action: "seek", seconds: 30 }));
  assert.equal(command({ action: "seek", seconds: -3 }), null);
  assert.equal(command({ action: "delete-everything" }), null);
  assert.equal(parseMessage({ v: 1, type: "command", from: "a", command: { action: "next" } }), null, "no recipient");
});

test("a handoff whose index would land on the wrong song is refused", () => {
  const handoff = (queue: unknown[], index: number) =>
    parseMessage({ v: 1, type: "handoff", from: "a", to: "b", handoff: { queue, index, position: 3, prefer: null } });

  assert.ok(handoff([song("x"), song("y")], 1));
  assert.equal(handoff([song("x"), song("y")], 2), null, "out of range");
  assert.equal(handoff([song("x"), song("y")], 0.5), null, "not a position");
  assert.equal(handoff([], 0), null, "nothing to play");
  // Dropping the broken entry would move index 1 from "y" to nothing, so the whole thing goes.
  assert.equal(handoff([null, song("y")], 1), null);
});

// ---------------------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------------------

test("the later claim wins, and a same-millisecond tie still has one winner", () => {
  assert.ok(newer({ tab: "a", at: 2 }, { tab: "b", at: 1 }));
  assert.ok(!newer({ tab: "a", at: 1 }, { tab: "b", at: 2 }));
  assert.notEqual(newer({ tab: "a", at: 1 }, { tab: "b", at: 1 }), newer({ tab: "b", at: 1 }, { tab: "a", at: 1 }));
});

test("starting to play claims the speakers", () => {
  const { model, message, pause } = localState(initialModel("a"), "playing", 100);
  assert.ok(owns(model));
  assert.deepEqual(message, { type: "claim", from: "a", at: 100 });
  assert.equal(pause, false);
});

test("a claim is never behind the newest one heard, whatever the clock says", () => {
  const heard = receive(initialModel("a"), { type: "claim", from: "b", at: 500 }, IDLE, 500).model;
  const { message } = localState(heard, "playing", 400);
  assert.ok(message?.type === "claim" && message.at > 500);
});

test("a playing tab pauses when another tab starts playing", () => {
  const step = receive(owner("a", 100), { type: "claim", from: "b", at: 200 }, PLAYING, 200);
  assert.deepEqual(step.effect, { kind: "pause" });
  assert.equal(step.model.claim?.tab, "b");
  assert.ok(!owns(step.model));
});

test("a paused tab gives up ownership quietly", () => {
  const step = receive(owner("a", 100), { type: "claim", from: "b", at: 200 }, PAUSED, 200);
  assert.equal(step.effect, null, "nothing to pause — and a toggle would start it");
  assert.equal(step.model.claim?.tab, "b");
});

test("two claims that cross leave exactly one tab playing", () => {
  const a = owner("a", 100);
  const b = owner("b", 101);
  const atA = receive(a, { type: "claim", from: "b", at: 101 }, PLAYING, 101);
  const atB = receive(b, { type: "claim", from: "a", at: 100 }, PLAYING, 101);

  assert.deepEqual(atA.effect, { kind: "pause" });
  assert.equal(atB.effect, null, "the older claim changes nothing");
  assert.ok(owns(atB.model));
});

test("the owner's repeated reports do not pause anything twice", () => {
  // The only pause available is the player's toggle, so a second one would start it again.
  const deposed = receive(owner("a", 100), { type: "claim", from: "b", at: 200 }, PLAYING, 200).model;
  const again = receive(deposed, { type: "state", from: "b", at: 200, report: report() }, PLAYING, 201);
  assert.equal(again.effect, null);
});

test("a tab deposed mid-load pauses when the load lands, instead of claiming", () => {
  const step = receive(owner("a", 100), { type: "claim", from: "b", at: 200 }, LOADING, 200);
  assert.equal(step.effect, null, "nothing is playing yet");

  const landed = localState(step.model, "playing", 300);
  assert.equal(landed.pause, true);
  assert.equal(landed.message, null, "the load finishing is not a press of play");
  assert.equal(landed.model.claim?.tab, "b");
});

test("a pending yield is dropped by a stop, so the next play is the reader's", () => {
  const deposed = receive(initialModel("a"), { type: "claim", from: "b", at: 200 }, LOADING, 200).model;
  const stopped = localState(deposed, "paused", 250).model;
  const pressed = localState(stopped, "playing", 300);
  assert.equal(pressed.pause, false);
  assert.equal(pressed.message?.type, "claim");
});

test("a pending yield is dropped when a new song is picked here", () => {
  const deposed = receive(initialModel("a"), { type: "claim", from: "b", at: 200 }, LOADING, 200).model;
  const picked = localSong(deposed, true).model;
  assert.equal(localState(picked, "playing", 300).message?.type, "claim");
});

test("an owner carrying on — a buffer draining, the next song — does not re-claim", () => {
  const playing = owner("a", 100);
  const buffering = localState(playing, "loading", 150).model;
  const resumed = localState(buffering, "playing", 160);
  assert.equal(resumed.message, null);

  // After a pause, playing again *is* a press of play.
  const paused = localState(resumed.model, "paused", 170).model;
  assert.equal(localState(paused, "playing", 180).message?.type, "claim");
});

// ---------------------------------------------------------------------------------------
// Mirroring
// ---------------------------------------------------------------------------------------

test("an empty tab mirrors the owner from its first report", () => {
  const step = receive(initialModel("c"), { type: "state", from: "a", at: 100, report: report() }, IDLE, 1000);
  assert.equal(step.effect, null);
  assert.equal(step.model.remote?.tab, "a");
  assert.equal(step.model.remote?.report.song.title, "Song");
});

test("a deposed tab's last report is not mirrored", () => {
  const mirror = receive(initialModel("c"), { type: "claim", from: "b", at: 200 }, IDLE, 1000).model;
  const stale = receive(mirror, { type: "state", from: "a", at: 100, report: report() }, IDLE, 1001);
  assert.equal(stale.model.remote, null);
});

test("a new owner replaces the one being mirrored", () => {
  const mirror = receive(initialModel("c"), { type: "state", from: "a", at: 100, report: report() }, IDLE, 1000).model;
  const moved = receive(mirror, { type: "claim", from: "b", at: 200 }, IDLE, 1001).model;
  assert.equal(moved.remote, null, "a's song is no longer the one playing");
  assert.equal(moved.claim?.tab, "b");
});

test("the owner going away takes the mirror with it", () => {
  const mirror = receive(initialModel("c"), { type: "state", from: "a", at: 100, report: report() }, IDLE, 1000).model;
  const gone = receive(mirror, { type: "gone", from: "a" }, IDLE, 1001).model;
  assert.equal(gone.remote, null);
  assert.equal(gone.claim, null);
});

test("an owner that falls silent is asked, then let go", () => {
  const mirror = receive(initialModel("c"), { type: "state", from: "a", at: 100, report: report() }, IDLE, 1000).model;

  assert.equal(tick(mirror, 1000 + PING_AFTER_MS - 1).ping, false);
  const asked = tick(mirror, 1000 + PING_AFTER_MS + 1);
  assert.equal(asked.ping, true);
  assert.equal(tick(asked.model, 1000 + PING_AFTER_MS + 2).ping, false, "once per interval, not per tick");

  const dropped = tick(asked.model, 1000 + STALE_AFTER_MS + 1).model;
  assert.equal(dropped.remote, null);
  assert.equal(dropped.claim, null);
});

test("only the owner answers a hello, and only with something loaded", () => {
  const hello: Message = { type: "hello", from: "c" };
  assert.deepEqual(receive(owner("a", 100), hello, PLAYING, 200).effect, { kind: "announce" });
  assert.equal(receive(owner("a", 100), hello, IDLE, 200).effect, null);
  assert.equal(receive(initialModel("a"), hello, PAUSED, 200).effect, null);
});

test("commands run only on the owner they were addressed to", () => {
  const command: Message = { type: "command", from: "c", to: "a", command: { action: "next" } };
  assert.deepEqual(receive(owner("a", 100), command, PLAYING, 200).effect, { kind: "run", command: { action: "next" } });
  assert.equal(receive(owner("a", 100), { ...command, to: "b" }, PLAYING, 200).effect, null);
  assert.equal(receive(initialModel("a"), command, PAUSED, 200).effect, null, "a deposed tab ignores it");
});

test("emptying the owner's queue gives ownership up", () => {
  const { model, message } = localSong(owner("a", 100), false);
  assert.ok(!owns(model));
  assert.deepEqual(message, { type: "gone", from: "a" });
  assert.equal(localSong(initialModel("b"), false).message, null, "a tab that owned nothing says nothing");
});

test("leaving announces itself only from the owner", () => {
  assert.deepEqual(leaving(owner("a", 100)).message, { type: "gone", from: "a" });
  assert.equal(leaving(initialModel("a")).message, null);
});

// ---------------------------------------------------------------------------------------
// Taking over
// ---------------------------------------------------------------------------------------

test("taking over asks the owner, which hands its queue to the asker", () => {
  const mirror = receive(initialModel("c"), { type: "state", from: "a", at: 100, report: report() }, IDLE, 1000).model;
  const ask = asking(mirror);
  assert.deepEqual(ask.message, { type: "take", from: "c", to: "a" });

  const atOwner = receive(owner("a", 100), ask.message!, PLAYING, 1001);
  assert.deepEqual(atOwner.effect, { kind: "handoff", to: "c" });

  const handoff = { queue: [song("x"), song("y")], index: 1, position: 42, prefer: "audius" };
  const adopted = receive(ask.model, { type: "handoff", from: "a", to: "c", handoff }, IDLE, 1002);
  assert.deepEqual(adopted.effect, { kind: "adopt", handoff });
  assert.equal(adopted.model.asked, null);
});

test("a handoff nobody asked for does not replace the queue", () => {
  const handoff = { queue: [song("x")], index: 0, position: 0, prefer: null };
  const step = receive(initialModel("c"), { type: "handoff", from: "a", to: "c", handoff }, IDLE, 1000);
  assert.equal(step.effect, null);
});

test("a handoff that arrives after something was started here is dropped", () => {
  const mirror = receive(initialModel("c"), { type: "state", from: "a", at: 100, report: report() }, IDLE, 1000).model;
  const asked = asking(mirror).model;
  const handoff = { queue: [song("x")], index: 0, position: 0, prefer: null };
  const step = receive(asked, { type: "handoff", from: "a", to: "c", handoff }, LOADING, 1001);
  assert.equal(step.effect, null);
});

test("a tab ignores its own messages", () => {
  const model = owner("a", 100);
  assert.equal(receive(model, { type: "claim", from: "a", at: 900 }, PLAYING, 900).model, model);
});
