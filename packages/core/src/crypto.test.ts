import assert from "node:assert/strict";
import { test } from "node:test";

import { CryptoConfigError, DecryptionError, decrypt, encrypt, generateKey, loadKey, safeEqual } from "./crypto.ts";

const key = loadKey(generateKey());

test("round-trips a token", () => {
  const secret = "BQC4v...refresh-token";
  assert.equal(decrypt(encrypt(secret, key), key), secret);
});

test("produces a different ciphertext each time (random IV)", () => {
  const a = encrypt("same", key);
  const b = encrypt("same", key);
  assert.notEqual(a, b, "identical plaintext must not produce identical ciphertext");
  assert.equal(decrypt(a, key), decrypt(b, key));
});

test("rejects a ciphertext encrypted under a different key", () => {
  const other = loadKey(generateKey());
  assert.throws(() => decrypt(encrypt("secret", key), other), DecryptionError);
});

test("detects tampering", () => {
  const payload = encrypt("secret", key);
  const parts = payload.split(".");
  // Flip a character in the ciphertext segment.
  const ct = parts[3]!;
  parts[3] = (ct[0] === "A" ? "B" : "A") + ct.slice(1);
  assert.throws(() => decrypt(parts.join("."), key), DecryptionError);
});

test("refuses malformed envelopes rather than guessing", () => {
  assert.throws(() => decrypt("not-an-envelope", key), DecryptionError);
  assert.throws(() => decrypt("v2.a.b.c", key), DecryptionError);
});

test("fails loudly on a missing or wrong-sized key", () => {
  assert.throws(() => loadKey(undefined), CryptoConfigError);
  assert.throws(() => loadKey(Buffer.alloc(16).toString("base64")), CryptoConfigError);
});

test("safeEqual compares correctly", () => {
  assert.ok(safeEqual("shared-secret", "shared-secret"));
  assert.ok(!safeEqual("shared-secret", "shared-secrez"));
  assert.ok(!safeEqual("short", "much-longer-value"));
});
