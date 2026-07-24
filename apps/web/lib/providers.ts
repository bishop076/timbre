import "server-only";

import { MemoryBucketStore, RateLimiter } from "@timbre/core";
import { createYtMusicProvider, registerProvider } from "@timbre/providers";

import { getEnv } from "./env";

/**
 * Wires up the source registry once per process.
 *
 * Cached on globalThis for the same reason as the database pool: Next's dev
 * hot-reload re-evaluates modules on every edit, and re-registering providers
 * each time would also reset rate-limit state.
 */

const globalForProviders = globalThis as unknown as {
  __timbreProviders?: { limiter: RateLimiter };
};

function setup(): { limiter: RateLimiter } {
  const env = getEnv();

  registerProvider(
    createYtMusicProvider({
      baseUrl: env.YTMUSIC_SERVICE_URL,
      sharedSecret: env.YTMUSIC_SHARED_SECRET,
    }),
  );

  // In-memory for now: search runs in a single web process, and pacing does
  // not yet need to be shared. Swap to PgBucketStore from @timbre/db once a
  // separate worker also makes upstream calls.
  return { limiter: new RateLimiter(new MemoryBucketStore()) };
}

export function getProviderRuntime(): { limiter: RateLimiter } {
  globalForProviders.__timbreProviders ??= setup();
  return globalForProviders.__timbreProviders;
}
