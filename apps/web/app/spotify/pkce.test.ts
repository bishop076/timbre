import assert from "node:assert/strict";
import { test } from "node:test";

import { authorizeUrl, challengeFor, createVerifier } from "./pkce.ts";

test("the verifier is the length and alphabet RFC 7636 allows", () => {
  const verifier = createVerifier();
  assert.equal(verifier.length, 64);
  assert.match(verifier, /^[A-Za-z0-9\-._~]+$/, "unreserved characters only");
});

test("two verifiers are never the same", () => {
  const seen = new Set(Array.from({ length: 32 }, () => createVerifier()));
  assert.equal(seen.size, 32);
});

test("the challenge is the unpadded base64url SHA-256 of the verifier", async () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  assert.equal(await challengeFor(verifier), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("the challenge carries nothing a URL would mangle", async () => {
  for (let i = 0; i < 8; i += 1) {
    assert.doesNotMatch(await challengeFor(createVerifier()), /[+/=]/, "base64url, not base64");
  }
});

test("the authorize URL asks for S256 and carries the state back", () => {
  const url = new URL(
    authorizeUrl({
      clientId: "abc123",
      redirectUri: "http://127.0.0.1:3000/spotify/callback",
      challenge: "CHALLENGE",
      state: "STATE",
    }),
  );
  assert.equal(url.origin + url.pathname, "https://accounts.spotify.com/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), "CHALLENGE");
  assert.equal(url.searchParams.get("state"), "STATE");
  assert.equal(url.searchParams.get("client_id"), "abc123");
  assert.deepEqual((url.searchParams.get("scope") ?? "").split(" ").sort(), [
    "streaming",
    "user-modify-playback-state",
    "user-read-email",
    "user-read-private",
  ]);
});
