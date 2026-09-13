import assert from "node:assert/strict";
import { test } from "node:test";

import { FRESH, leadAfterRefusal, leadFor, type LeadState } from "./spotify-lead.ts";

test("Spotify never leads without a token, however willing the state is", () => {
  assert.equal(leadFor(FRESH, false), false);
  assert.equal(leadFor(FRESH, true), true);
});

test("the free account, which is the case nobody can sit down and reproduce", () => {
  // Connected and untried, so it leads — a free account is indistinguishable from Premium here.
  let state: LeadState = FRESH;
  assert.equal(leadFor(state, true), true);

  // It leads, the SDK refuses the way it refuses a free account, and the song falls through to
  // YouTube rather than settling for a clip the queue could not advance past.
  state = { ...state, leading: true };
  const refused = leadAfterRefusal(state, "account_error");
  assert.equal(refused.action, "fall-through");

  // And every song after it opens on YouTube, because the account does not change between them.
  assert.equal(leadFor(refused.state, true), false);
});

test("a refusal that is about one track does not cost the next song its lead", () => {
  const state: LeadState = { canLead: true, leading: true };

  for (const reason of ["refused", "playback_error", "device-offline"]) {
    const after = leadAfterRefusal(state, reason);
    assert.equal(after.action, "fall-through", reason);
    assert.equal(leadFor(after.state, true), true, reason);
  }
});

test("every session-wide verdict stops the lead, not just the free account", () => {
  const state: LeadState = { canLead: true, leading: true };

  for (const reason of [
    "not-connected",
    "sdk-failed",
    "blocked",
    "initialization_error",
    "authentication_error",
    "stale-scopes",
  ]) {
    assert.equal(leadFor(leadAfterRefusal(state, reason).state, true), false, reason);
  }
});

test("a Spotify picked by hand keeps its 30-second embed and its explanation", () => {
  // `leading` is false when the ladder reached Spotify last, or when somebody pressed it: the
  // fallback has already been tried or was not wanted, so downgrading in place is still right.
  const state: LeadState = { canLead: true, leading: false };
  const after = leadAfterRefusal(state, "account_error");

  assert.equal(after.action, "downgrade");
  assert.equal(after.state, state);
  assert.equal(leadFor(after.state, true), true);
});

test("falling through clears the lead, so a second verdict cannot double-count", () => {
  const first = leadAfterRefusal({ canLead: true, leading: true }, "refused");
  assert.equal(first.state.leading, false);
  assert.equal(leadAfterRefusal(first.state, "account_error").action, "downgrade");
});
