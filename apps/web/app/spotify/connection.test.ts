import assert from "node:assert/strict";
import { test } from "node:test";

import { completeConnect } from "./connection.ts";

const PLANTED = "Your account is locked. Verify at spotify-help.example";

function storage(seed: Record<string, string> = {}) {
  const backing = { ...seed };
  return {
    backing,
    getItem: (key: string) => backing[key] ?? null,
    setItem: (key: string, value: string) => {
      backing[key] = value;
    },
    removeItem: (key: string) => {
      delete backing[key];
    },
  };
}

function signingIn() {
  const session = storage({ "timbre:spotify:verifier": "VERIFIER", "timbre:spotify:state": "STATE" });
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: storage(),
    sessionStorage: session,
  };
  return session.backing;
}

test("an error that does not carry this sign-in's state is not shown", async () => {
  signingIn();
  const error = await completeConnect(new URLSearchParams({ error: PLANTED, state: "FORGED" }));
  assert.equal(error, "The sign-in came back with the wrong state.");
});

test("Spotify's error codes become fixed sentences, never the parameter itself", async () => {
  signingIn();
  assert.equal(
    await completeConnect(new URLSearchParams({ error: "access_denied", state: "STATE" })),
    "Sign-in was cancelled.",
  );

  signingIn();
  assert.equal(
    await completeConnect(new URLSearchParams({ error: PLANTED, state: "STATE" })),
    "Spotify refused the sign-in.",
  );
});

test("the verifier and state are spent by the first callback, whatever it carries", async () => {
  const session = signingIn();
  await completeConnect(new URLSearchParams({ error: "access_denied", state: "STATE" }));
  assert.deepEqual(session, {});
});
