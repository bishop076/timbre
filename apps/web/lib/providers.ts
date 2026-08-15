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
 * Wires up the source registry and the shared rate limiter, which is cached on globalThis
 * because dev hot-reload re-evaluates modules and a fresh limiter forgets how much quota
 * was spent. Registration is checked separately rather than guarded by that cache: the
 * registry is a module-scoped Map, so HMR can empty it while the cached limiter survives —
 * a runtime with no sources and no error, which is what hid Deezer and Apple.
 */

const globalForProviders = globalThis as unknown as {
  __timbreLimiter?: RateLimiter;
};

function registerAll(): void {
  const env = getEnv();

  // YouTube Music first: the only source that can be both searched and played. Deezer's
  // ISRCs are what make cross-source matching reliable.
  registerProvider(
    createYtMusicProvider({
      baseUrl: env.YTMUSIC_SERVICE_URL,
      sharedSecret: env.YTMUSIC_SHARED_SECRET,
    }),
  );
  // SoundCloud is deliberately NOT registered: `createSoundCloudProvider()` works, but
  // catalogue search needs a client_id gated behind a paid account and weeks of approval.
  // To ship it, set `searchable: true` in soundcloud.ts and register here. See docs/BLOCKED.md.
  registerProvider(createDeezerProvider());
  registerProvider(createAppleProvider());
}

export function getProviderRuntime(): { limiter: RateLimiter } {
  // In-memory permanently: Timbre runs no database, and per-instance pacing is the right
  // scope when each instance has its own outbound IP and the limits are per-IP.
  globalForProviders.__timbreLimiter ??= new RateLimiter(new MemoryBucketStore());

  if (listProviders().length === 0) registerAll();

  return { limiter: globalForProviders.__timbreLimiter };
}
