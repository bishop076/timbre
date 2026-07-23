/**
 * Envelope encryption for data we must be able to read back: provider OAuth
 * tokens and, for BYO providers, the user's own client id/secret.
 *
 * These are third-party credentials held on the user's behalf, so they are
 * never stored in plaintext. The ciphertext is self-describing and versioned,
 * so a future key rotation can decrypt v1 while writing v2.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12; // 96-bit nonce, the size GCM is defined for
const TAG_BYTES = 16;
const VERSION = "v1";

export class CryptoConfigError extends Error {}
export class DecryptionError extends Error {}

/**
 * Generates a fresh key, base64-encoded for use as TIMBRE_ENCRYPTION_KEY.
 * Run via `pnpm --filter @timbre/core exec node -e "..."` when setting up .env.
 */
export function generateKey(): string {
  return randomBytes(KEY_BYTES).toString("base64");
}

/**
 * Loads and validates the encryption key. Throws rather than falling back to a
 * default: a silently weak key would be worse than a hard failure at boot.
 */
export function loadKey(raw: string | undefined = process.env.TIMBRE_ENCRYPTION_KEY): Buffer {
  if (!raw) {
    throw new CryptoConfigError(
      "TIMBRE_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32`.",
    );
  }

  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new CryptoConfigError("TIMBRE_ENCRYPTION_KEY is not valid base64.");
  }

  if (key.length !== KEY_BYTES) {
    throw new CryptoConfigError(
      `TIMBRE_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}.`,
    );
  }
  return key;
}

/** Returns `v1.<iv>.<tag>.<ciphertext>`, each segment base64url. */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/** Reverses {@link encrypt}. Throws {@link DecryptionError} on tamper or wrong key. */
export function decrypt(payload: string, key: Buffer): string {
  const parts = payload.split(".");
  if (parts.length !== 4) {
    throw new DecryptionError("Malformed ciphertext envelope.");
  }

  const [version, ivPart, tagPart, ctPart] = parts as [string, string, string, string];
  if (version !== VERSION) {
    throw new DecryptionError(`Unsupported ciphertext version "${version}".`);
  }

  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new DecryptionError("Ciphertext envelope has wrong IV or tag length.");
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(ctPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // GCM auth failure. Deliberately opaque — do not leak whether the key was
    // wrong or the payload was tampered with.
    throw new DecryptionError("Could not decrypt: bad key or tampered ciphertext.");
  }
}

/** Constant-time compare, for the shared secret guarding the ytmusic sidecar. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
