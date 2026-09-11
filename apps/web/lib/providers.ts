import "server-only";

import { MemoryBucketStore, RateLimiter } from "@timbre/core";
import {
  createAppleProvider,
  createArchiveProvider,
  createAudiusProvider,
  createDeezerProvider,
  createMixcloudProvider,
  createClientIdResolver,
  createSoundCloudProvider,
  createSpotifyProvider,
  createYtMusicLyrics,
  createYtMusicProvider,
  listProviders,
  registerProvider,
} from "@timbre/providers";

import { getEnv } from "./env";

const globalForProviders = globalThis as unknown as {
  __timbreLimiter?: RateLimiter;
  __timbreSoundCloudClientId?: () => Promise<string | null>;
};

function registerAll(): void {
  const env = getEnv();
  const clientId = env.SOUNDCLOUD_DIRECT_API
    ? (globalForProviders.__timbreSoundCloudClientId ??= createClientIdResolver(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      ))
    : undefined;

  [
    createYtMusicProvider({
      baseUrl: env.YTMUSIC_SERVICE_URL,
      sharedSecret: env.YTMUSIC_SHARED_SECRET,
    }),
    createSoundCloudProvider({ apiBase: env.SOUNDCLOUD_API_BASE, clientId }),
    createAudiusProvider(),
    createArchiveProvider(),
    createMixcloudProvider(),
    createSpotifyProvider(),
    createDeezerProvider(),
    createAppleProvider(),
  ].forEach(registerProvider);
}

export function getProviderRuntime(): { limiter: RateLimiter } {
  const limiter = (globalForProviders.__timbreLimiter ??= new RateLimiter(new MemoryBucketStore()));
  if (listProviders().length === 0) registerAll();
  return { limiter };
}

export function getYtMusicLyrics() {
  const env = getEnv();
  return createYtMusicLyrics({
    baseUrl: env.YTMUSIC_SERVICE_URL,
    sharedSecret: env.YTMUSIC_SHARED_SECRET,
  });
}
