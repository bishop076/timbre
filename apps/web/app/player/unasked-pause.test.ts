import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASKED_MS,
  describeVerdict,
  judgePause,
  MAX_RESUMES,
  QUIET_MS,
  SETTLING_MS,
  type PauseFacts,
} from "./unasked-pause.ts";

const NOW = 1_000_000;

// Walked away: a long track, well past any press, playing for half a minute, nobody here for
// an hour.
const ALONE: PauseFacts = {
  now: NOW,
  askedAt: NOW - 60 * 60_000,
  interactedAt: NOW - 60 * 60_000,
  startedAt: NOW - 30_000,
  position: 30,
  duration: 240,
  readingAt: NOW,
  resumes: 0,
};

const facts = (over: Partial<PauseFacts>): PauseFacts => ({ ...ALONE, ...over });

test("a queue left alone is put back on", () => {
  assert.equal(judgePause(ALONE), "resume");
});

test("a pause that came from a press here is left to it", () => {
  assert.equal(judgePause(facts({ askedAt: NOW })), "asked");
  assert.equal(judgePause(facts({ askedAt: NOW - ASKED_MS })), "asked");
  // Just past the window the press is no longer *this* pause's cause. In life a press is also
  // an interaction, so the next rule holds it; that pairing is what the case below asserts.
  assert.equal(judgePause(facts({ askedAt: NOW - ASKED_MS - 1, interactedAt: NOW })), "user");
  // With nobody here for an hour, a stale press stamp protects nothing — which is the point of
  // stamping it rather than reading it as "a press happened at some time".
  assert.equal(judgePause(facts({ askedAt: NOW - ASKED_MS - 1 })), "resume");
});

test("a pause with someone still at the keyboard is theirs", () => {
  // The case this exists for: a press inside YouTube's own chrome, which reaches this document
  // only as the focus leaving it.
  assert.equal(judgePause(facts({ interactedAt: NOW })), "user");
  assert.equal(judgePause(facts({ interactedAt: NOW - QUIET_MS })), "user");
  assert.equal(judgePause(facts({ interactedAt: NOW - QUIET_MS - 1 })), "resume");
});

test("a source still starting its track is left to start", () => {
  // What a queue left alone actually hits: a track ends, the next one loads, and the new
  // source's own startup flicker arrives with the twenty-second grace long since lapsed. Read
  // as an unasked pause it was fought with a toggle, which is how playback ended up off.
  assert.equal(judgePause(facts({ startedAt: NOW, position: 0, duration: 1885 })), "starting");
  assert.equal(judgePause(facts({ startedAt: NOW - SETTLING_MS })), "starting");
  assert.equal(judgePause(facts({ startedAt: NOW - SETTLING_MS - 1 })), "resume");
});

test("someone at the keyboard still outranks a source that is starting", () => {
  assert.equal(judgePause(facts({ startedAt: NOW, interactedAt: NOW })), "user");
  assert.equal(judgePause(facts({ startedAt: NOW, askedAt: NOW })), "asked");
});

test("a track on its last seconds is left for the queue to advance", () => {
  assert.equal(judgePause(facts({ position: 239, duration: 240 })), "ending");
  assert.equal(judgePause(facts({ position: 238, duration: 240 })), "ending");
  assert.equal(judgePause(facts({ position: 237, duration: 240 })), "resume");
});

test("a track ending in a background tab is recognised from a stale reading", () => {
  // The bug this exists for, in the shape it actually arrives in: a four-minute track really is
  // at its end, but the tab has been in the background and the progress poll — clamped there to
  // once a minute — last spoke fifty seconds ago at 3:08. Judged on that number alone the track
  // has nearly a minute left, the end reads as the source giving up, and the rescue's toggle
  // lands on the next track's startup. Judged on when the reading was *taken*, it is an ending.
  const stale = { position: 188, duration: 240, readingAt: NOW - 50_000 };
  assert.equal(judgePause(facts(stale)), "ending");
  // Same numbers, fresh off the poll: 55 seconds left really is 55 seconds left.
  assert.equal(judgePause(facts({ ...stale, readingAt: NOW })), "resume");
});

test("a stale reading does not mute a rescue in the middle of a track", () => {
  // The other half of the bargain. A minute of clamped poll is the most the estimate can run
  // ahead, so a source that gave up halfway through a long track is still far enough from the
  // end to be put back on — the case that would otherwise have been traded away for the one
  // above.
  assert.equal(judgePause(facts({ position: 100, duration: 240, readingAt: NOW - 60_000 })), "resume");
});

test("a position never reported is not read as time served", () => {
  // `readingAt` of 0 means no source has ever said anything, so `position` is 0 for want of
  // news. Ageing that from the epoch would make every such pause an "ending" and switch the
  // rescue off entirely.
  assert.equal(judgePause(facts({ position: 0, duration: 240, readingAt: 0 })), "resume");
});

test("a source reporting no duration is still put back on", () => {
  // `duration - position` would be negative for every one of these, which read as "ending" and
  // would have switched the whole rule off for any source that reports no length.
  assert.equal(judgePause(facts({ position: 0, duration: 0 })), "resume");
  assert.equal(judgePause(facts({ position: 30, duration: 0 })), "resume");
});

test("a source that keeps stopping is not fought forever", () => {
  assert.equal(judgePause(facts({ resumes: MAX_RESUMES - 1 })), "resume");
  assert.equal(judgePause(facts({ resumes: MAX_RESUMES })), "exhausted");
  assert.equal(judgePause(facts({ resumes: MAX_RESUMES + 1 })), "exhausted");
});

test("a press here outranks everything, so nothing fights the listener", () => {
  // Every reason to resume, and a press a moment ago: still left alone.
  assert.equal(judgePause(facts({ askedAt: NOW, resumes: 0, position: 5, duration: 300 })), "asked");
});

test("every verdict says something, so the log never reads as a blank", () => {
  for (const verdict of ["asked", "user", "starting", "ending", "exhausted", "resume"] as const) {
    assert.match(describeVerdict(verdict, 0), /\S/);
  }
});
