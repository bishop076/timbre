import "server-only";

import { MemoryBucketStore, RateLimiter } from "@timbre/core";
import {
  createAppleProvider,
  createArchiveProvider,
  createAudiusProvider,
  createDeezerProvider,
  createSoundCloudProvider,
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
  // SoundCloud registers either way, and is searchable only when the operator has pointed
  // SOUNDCLOUD_API_BASE at something they run. Unset — the hosted default — it contributes
  // exactly what it always did: `resolve`, so a pasted URL still plays. Catalogue search
  // needs a client_id gated behind a paid account, and the only supported alternative moves
  // that to the self-hoster rather than to us. See docs/BLOCKED.md.
  registerProvider(createSoundCloudProvider({ apiBase: env.SOUNDCLOUD_API_BASE }));
  // Audius second: the only other source that can be both searched and played, and the
  // only one Timbre plays itself. Its catalogue is remixes, edits and DJ sets — the
  // derivative layer YouTube Music does not carry — so it widens the catalogue rather
  // than duplicating it.
  registerProvider(createAudiusProvider());
  // The Internet Archive contributes recommendations only — `searchable: false`, permanently.
  // Its index holds *shows*, and a plain query for the music Timbre's readers look for is
  // confidently wrong: measured, "Fred again.." led with a 1973 Grateful Dead tape. Scoped to
  // an exact creator it abstains instead, which is what makes it safe to register at all.
  registerProvider(createArchiveProvider());
  registerProvider(createDeezerProvider());
  registerProvider(createAppleProvider());
}

export function getProviderRuntime(): { limiter: RateLimiter } {
  /*
   * In memory, and therefore **per instance** — which is looser than it looks, and is a
   * trade rather than a solution.
   *
   * The justification here used to be that each instance has its own outbound IP, so a
   * per-instance bucket matched a per-IP limit. That is not true on Vercel: static outbound
   * IPs are a paid feature and even there a shared pool, so on Hobby the address is drawn
   * from a pool shared with other customers and can change between invocations. Serverless
   * therefore runs N of these buckets against upstream limits that count **one** — Apple's
   * is about 20/minute/IP, and it is the tightest thing in the system.
   *
   * Kept anyway, knowingly. `BucketStore` exists so this can become shared state the day it
   * needs to, but the only way to share it is a database, and not having one is the reason
   * Timbre is free to host. Pacing is a courtesy to upstream here, not an SLA.
   *
   * See docs/EXPOSURE.md, E-3 and E-4.
   */
  globalForProviders.__timbreLimiter ??= new RateLimiter(new MemoryBucketStore());

  if (listProviders().length === 0) registerAll();

  return { limiter: globalForProviders.__timbreLimiter };
}
