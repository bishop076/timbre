import assert from "node:assert/strict";
import { test } from "node:test";

import { accessToken, completeConnect, looksLikeClientId } from "./connection.ts";

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
    location: { origin: "https://timbre.example" },
  };
  return session.backing;
}

/** Every sentence the callback can show has to come from this file, never from the URL. */
function authored(failure: { title: string; detail: string } | null): string {
  assert.ok(failure, "expected a failure");
  return `${failure.title} ${failure.detail}`;
}

/**
 * Nothing here is allowed to reach accounts.spotify.com. The client id store caches its first
 * read for the life of the process, so a test that sets one hands it to every test after it, and
 * without this those would quietly make real requests.
 */
function spotifyAnswers(body: Record<string, unknown>, status = 400): () => void {
  const restore = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(new Response(JSON.stringify(body), { status }))) as typeof fetch;
  return () => {
    globalThis.fetch = restore;
  };
}

/**
 * A refresh token Spotify has rejected is dead, and leaving it in place made the panel claim a
 * connection that could never work again. A refresh that merely failed to reach Spotify has to
 * survive, or a dropped connection would sign people out.
 */
function connectedButStale(): Record<string, string> {
  const local = storage({
    "timbre:spotify": JSON.stringify({
      accessToken: "STALE",
      refreshToken: "REFRESH",
      expiresAt: Date.now() - 1000,
    }),
    "timbre:spotify:client-id": "4f2c1b9d8e7a4c3b9f0e1d2c3b4a5968",
  });
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: local,
    sessionStorage: storage(),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  return local.backing;
}

test("a refresh token Spotify rejects is thrown away, and says so", async () => {
  const local = connectedButStale();
  const restore = spotifyAnswers({ error: "invalid_grant" });

  try {
    assert.equal(await accessToken(), null);
  } finally {
    restore();
  }

  assert.equal(local["timbre:spotify"], undefined, "the dead grant is gone");
  assert.equal(local["timbre:spotify:lapsed"], "true", "and the panel can tell you why");
});

// This runs first on purpose. The token store reads `localStorage` once and then serves a cached
// snapshot, so a test that wants `accessToken` to see a stored connection has to be the one that
// causes that first read.
test("an error that does not carry this sign-in's state is not shown", async () => {
  signingIn();
  const failure = await completeConnect(new URLSearchParams({ error: PLANTED, state: "FORGED" }));
  assert.equal(failure?.title, "The sign-in came back with the wrong state");
  assert.doesNotMatch(authored(failure), /spotify-help\.example/);
});

test("Spotify's error codes become fixed sentences, never the parameter itself", async () => {
  signingIn();
  assert.equal(
    (await completeConnect(new URLSearchParams({ error: "access_denied", state: "STATE" })))?.title,
    "Sign-in was cancelled",
  );

  signingIn();
  assert.equal(
    (await completeConnect(new URLSearchParams({ error: "invalid_scope", state: "STATE" })))?.title,
    "The Spotify app does not allow what Timbre asked for",
  );

  signingIn();
  const planted = await completeConnect(new URLSearchParams({ error: PLANTED, state: "STATE" }));
  assert.equal(planted?.title, "Spotify refused the sign-in");
  assert.doesNotMatch(authored(planted), /spotify-help\.example/);
});

test("the verifier and state are spent by the first callback, whatever it carries", async () => {
  const session = signingIn();
  await completeConnect(new URLSearchParams({ error: "access_denied", state: "STATE" }));
  assert.deepEqual(session, {});
});

test("a second callback carrying the same state no longer has anything to check against", async () => {
  const session = signingIn();
  const restore = spotifyAnswers({ error: "invalid_grant" });
  try {
    const first = await completeConnect(new URLSearchParams({ code: "CODE", state: "STATE" }));
    assert.equal(first?.title, "That sign-in expired before it finished");
    assert.deepEqual(session, {}, "the first attempt spends both secrets");

    // The replay never reaches the exchange at all: there is nothing left to check it against,
    // which is the property that matters. A second redemption of a live code cannot happen here.
    const replayed = await completeConnect(new URLSearchParams({ code: "CODE", state: "STATE" }));
    assert.equal(replayed?.title, "This sign-in was not started here");
  } finally {
    restore();
  }
});

test("a redirect with neither a code nor an error is rejected rather than half-handled", async () => {
  signingIn();
  const failure = await completeConnect(new URLSearchParams({ state: "STATE" }));
  assert.equal(failure?.title, "Spotify did not send a code back");
});

test("a client id is one run of letters and digits, and nothing else", () => {
  assert.ok(looksLikeClientId("4f2c1b9d8e7a4c3b9f0e1d2c3b4a5968"));
  assert.ok(looksLikeClientId("  4f2c1b9d8e7a4c3b9f0e1d2c3b4a5968  "), "trimmed before judging");
  assert.equal(looksLikeClientId(""), false);
  assert.equal(looksLikeClientId("4f2c1b9d 8e7a4c3b"), false, "a pasted pair of values");
  assert.equal(looksLikeClientId("https://developer.spotify.com/app/abc"), false);
  assert.equal(looksLikeClientId("short"), false);
});

/**
 * The names `Object.prototype` answers to, whatever the table holds. `__proto__` comes back as
 * the prototype itself rather than as a function, so it is not nullish either.
 */
const INHERITED = ["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf"];

/**
 * `?error=banana` was refused properly; `?error=constructor` put a panel on the screen with no
 * heading and no sentence under it, because `REDIRECT_FAILURES[denied]` handed back the `Object`
 * constructor and `?? REFUSED` only fires on nullish. Anyone can hand out that link.
 */
test("an error parameter naming a property of Object is refused exactly like any other", async () => {
  for (const error of ["banana", ...INHERITED]) {
    signingIn();
    const failure = await completeConnect(new URLSearchParams({ error, state: "STATE" }));
    assert.equal(typeof failure, "object", `?error=${error} came back as something else`);
    assert.equal(failure?.title, "Spotify refused the sign-in", `?error=${error} had no heading`);
    assert.equal(typeof failure?.detail, "string", `?error=${error} had no explanation`);
    assert.equal(failure?.retry, true, `?error=${error} could not be retried`);
  }
});

/** The same table shape one step later: `SpotifyAuthError` carries `data.error` through verbatim. */
test("a token-endpoint error code naming a property of Object still gets a written sentence", async () => {
  for (const code of INHERITED) {
    signingIn();
    const restore = spotifyAnswers({ error: code });
    try {
      const failure = await completeConnect(new URLSearchParams({ code: "CODE", state: "STATE" }));
      assert.equal(failure?.title, "Spotify refused the sign-in", `error=${code} had no heading`);
      assert.equal(typeof failure?.detail, "string", `error=${code} had no explanation`);
      assert.equal(failure?.retry, true);
    } finally {
      restore();
    }
  }
});

/** And the codes that do have a sentence still get theirs. */
test("the exchange codes Timbre writes sentences for keep them", async () => {
  for (const [code, title] of [
    ["invalid_grant", "That sign-in expired before it finished"],
    ["invalid_client", "Spotify does not recognise that client id"],
    ["invalid_request", "Spotify rejected the sign-in request"],
  ] as const) {
    signingIn();
    const restore = spotifyAnswers({ error: code });
    try {
      const failure = await completeConnect(new URLSearchParams({ code: "CODE", state: "STATE" }));
      assert.equal(failure?.title, title);
    } finally {
      restore();
    }
  }
});
