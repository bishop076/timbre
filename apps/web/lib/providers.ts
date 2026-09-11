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

function clientIdResolver() {
  return (globalForProviders.__timbreSoundCloudClientId ??= createClientIdResolver(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  ));
}

function registerAll(): void {
  const env = getEnv();

  registerProvider(
    createYtMusicProvider({
      baseUrl: env.YTMUSIC_SERVICE_URL,
      sharedSecret: env.YTMUSIC_SHARED_SECRET,
    }),
  );
  registerProvider(
    createSoundCloudProvider({
      apiBase: env.SOUNDCLOUD_API_BASE,
      clientId: env.SOUNDCLOUD_DIRECT_API ? clientIdResolver() : undefined,
    }),
  );
  registerProvider(createAudiusProvider());
  registerProvider(createArchiveProvider());
  registerProvider(createMixcloudProvider());
  registerProvider(createSpotifyProvider());
  registerProvider(createDeezerProvider());
  registerProvider(createAppleProvider());
}

export function getProviderRuntime(): { limiter: RateLimiter } {
  globalForProviders.__timbreLimiter ??= new RateLimiter(new MemoryBucketStore());

  if (listProviders().length === 0) registerAll();

  return { limiter: globalForProviders.__timbreLimiter };
}

export function getYtMusicLyrics() {
  const env = getEnv();
  return createYtMusicLyrics({
    baseUrl: env.YTMUSIC_SERVICE_URL,
    sharedSecret: env.YTMUSIC_SHARED_SECRET,
  });
}
