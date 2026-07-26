import "server-only";

import { MemoryBucketStore, RateLimiter } from "@timbre/core";
import {
  createAppleProvider,
  createDeezerProvider,
  createYtMusicProvider,
  listProviders,
  registerProvider,
} from "@timbre/providers";

import { getEnv } from "./env";

/**
 * Wires up the source registry and the shared rate limiter.
 *
 * The limiter is cached on globalThis for the same reason as the database
 * pool: Next's dev hot-reload re-evaluates modules on every edit, and a fresh
 * limiter each time would forget how much quota had been spent.
 *
 * Registration is checked separately rather than being guarded by that cache.
 * The registry lives in a module-scoped Map inside @timbre/providers, so HMR
 * can empty it while the cached limiter survives — leaving a runtime with no
 * sources and no error, which is exactly the silent failure that hid Deezer
 * and Apple after they were added.
 */

const globalForProviders = globalThis as unknown as {
  __timbreLimiter?: RateLimiter;
};

function registerAll(): void {
  const env = getEnv();

  // YouTube Music first: the only source Timbre can actually play, so its
  // results lead. Deezer and Apple contribute identity, artwork and
  // availability — Deezer's ISRCs are what make cross-source matching reliable.
  registerProvider(
    createYtMusicProvider({
      baseUrl: env.YTMUSIC_SERVICE_URL,
      sharedSecret: env.YTMUSIC_SHARED_SECRET,
    }),
  );
  registerProvider(createDeezerProvider());
  registerProvider(createAppleProvider());
}

export function getProviderRuntime(): { limiter: RateLimiter } {
  // In-memory for now: search runs in a single web process. Swap to
  // PgBucketStore from @timbre/db once a separate worker also calls upstream.
  globalForProviders.__timbreLimiter ??= new RateLimiter(new MemoryBucketStore());

  if (listProviders().length === 0) registerAll();

  return { limiter: globalForProviders.__timbreLimiter };
}
