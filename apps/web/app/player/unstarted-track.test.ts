import assert from "node:assert/strict";
import { test } from "node:test";

import { judgeStart, MOST_RESTARTS, REFUSED_START, UNSTARTED_MS, type StartFacts } from "./unstarted-track.ts";
import { SETTLING_MS } from "./unasked-pause.ts";

const NOW = 1_000_000;

// The measured stall: a playlist left running, the queue moves to the next song, the source is
// handed it, and the browser refuses to start it. No press since, no audio ever.
const REFUSED: StartFacts = {
  played: false,
  askedAt: NOW - 5 * 60_000,
  startedAt: NOW - UNSTARTED_MS,
  restarts: 0,
};

const facts = (over: Partial<StartFacts>): StartFacts => ({ ...REFUSED, ...over });

test("a track the source never started is put back on, then given up on", () => {
  // Measured on a production build with `--autoplay-policy=user-gesture-required`: the third
  // song of a playlist sat on "Audius 0:00" with the play button reading Play for 248s and
  // counting, `readyState` 4 and `currentTime` 0 — the whole stream in memory, never played.
  // Nothing was logged and no rung of the ladder ran, because the only thing the app did with
  // the refusal was write "paused" down.
  assert.equal(judgeStart(REFUSED), "restart");
  assert.equal(judgeStart(facts({ restarts: 1 })), "restart");
  assert.equal(judgeStart(facts({ restarts: MOST_RESTARTS })), "refused");
  assert.equal(judgeStart(facts({ restarts: MOST_RESTARTS + 1 })), "refused");
});

test("a track that played is never restarted, however it came to be paused", () => {
  // The pause that interrupts playback belongs to `unasked-pause.ts`, which weighs whether the
  // listener meant it. Two rescues fighting over one pause is playback flickering on and off.
  assert.equal(judgeStart(facts({ played: true })), "played");
  assert.equal(judgeStart(facts({ played: true, restarts: MOST_RESTARTS })), "played");
});

test("a press since this source was handed the track is the reason it is paused", () => {
  // Pausing a song while it is still loading is a thing people do, and the queue must not
  // shove it back on underneath them.
  assert.equal(judgeStart(facts({ askedAt: NOW })), "asked");
  assert.equal(judgeStart(facts({ askedAt: REFUSED.startedAt })), "asked");
  // A press from *before* the handover belongs to the previous track and says nothing here.
  assert.equal(judgeStart(facts({ askedAt: REFUSED.startedAt - 1 })), "restart");
});

test("the deadline outlasts the startup flicker every embed reports through", () => {
  // Mixcloud sends two pauses within a second of being handed a cloudcast and SoundCloud's
  // widget reports one mid-handshake. `SETTLING_MS` is the window `unasked-pause.ts` measured
  // those against; a shorter deadline here would fight a source that was about to play.
  assert.ok(UNSTARTED_MS >= SETTLING_MS);
});

test("the reason given names autoplay as a possibility, not as a finding", () => {
  // The page cannot tell a browser-wide block from one embed refusing, and asserting a cause
  // nobody verified is the same mistake in a new sentence.
  assert.match(REFUSED_START, /may be blocked/);
  assert.doesNotMatch(REFUSED_START, /no copy|does not exist/);
});
