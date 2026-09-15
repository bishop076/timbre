import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { clearLogs, log, readLogs } from "./logs.ts";

beforeEach(() => clearLogs());

test("a line is kept as written, and the panel prints it unchanged", () => {
  log("warn", "deezer refused: 403");

  const [entry] = readLogs();
  assert.equal(entry?.level, "warn");
  assert.equal(entry?.text, "deezer refused: 403");
  assert.equal(entry?.message, "deezer refused: 403");
  assert.equal(entry?.count, 1);
});

test("the same line repeating collapses into one entry that counts", () => {
  for (let index = 0; index < 4; index += 1) log("error", "YouTube IFrame error 150 on video abc");

  const entries = readLogs();
  assert.equal(entries.length, 1, "a retry loop must not evict everything that led up to it");
  assert.equal(entries[0]?.count, 4);
  assert.equal(entries[0]?.message, "YouTube IFrame error 150 on video abc ×4");
  assert.equal(entries[0]?.text, "YouTube IFrame error 150 on video abc", "the base is unmarked");
});

test("a repeat keeps its id, so the panel does not remount the row", () => {
  log("warn", "same");
  const first = readLogs()[0]!.id;
  log("warn", "same");
  assert.equal(readLogs()[0]!.id, first);
});

test("only the line immediately before counts as a repeat", () => {
  log("warn", "audius refused");
  log("warn", "audius refused");
  log("info", "3/4 sources answered");
  log("warn", "audius refused");

  assert.deepEqual(
    readLogs().map((entry) => [entry.text, entry.count]),
    [
      ["audius refused", 2],
      ["3/4 sources answered", 1],
      ["audius refused", 1],
    ],
  );
});

test("the same words at a different level are a different entry", () => {
  log("warn", "deezer refused");
  log("error", "deezer refused");

  assert.deepEqual(
    readLogs().map((entry) => entry.level),
    ["warn", "error"],
  );
});

test("a repeat moves to the latest time, because the question is whether it is still happening", () => {
  log("warn", "still going");
  const first = readLogs()[0]!.at;
  const later = first + 5_000;
  const now = Date.now;
  Date.now = () => later;
  try {
    log("warn", "still going");
  } finally {
    Date.now = now;
  }
  assert.equal(readLogs()[0]!.at, later);
});

test("one enormous line cannot take over the panel", () => {
  log("error", `Spotify: play refused (502) ${"x".repeat(2000)}`);

  const [entry] = readLogs();
  assert.equal(entry?.message.length, 300);
  assert.ok(entry?.message.endsWith("…"));
});

test("whitespace is flattened, so a multi-line cause stays one row", () => {
  log("warn", "Playlist cover:\n  QuotaExceededError\n\n  at store()");

  assert.equal(readLogs()[0]?.message, "Playlist cover: QuotaExceededError at store()");
});

test("a line with nothing in it is not an entry", () => {
  log("info", "   \n  ");
  assert.equal(readLogs().length, 0);
});

test("the buffer holds a hundred and drops the oldest", () => {
  for (let index = 0; index < 130; index += 1) log("info", `event ${index}`);

  const entries = readLogs();
  assert.equal(entries.length, 100);
  assert.equal(entries[0]?.text, "event 30");
  assert.equal(entries.at(-1)?.text, "event 129");
});

test("clearing empties it", () => {
  log("info", "something");
  clearLogs();
  assert.deepEqual(readLogs(), []);
});
