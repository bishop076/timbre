/**
 * Adapter registry.
 *
 * Empty in Phase 0 — the interface exists before any implementation, so the
 * app, the ingest jobs and the UI can all be built against the seam. Phase 1
 * registers SoundCloud, then Spotify, then YouTube Music.
 */

import { PROVIDER_IDS, type ProviderId } from "@timbre/core";

import type { MusicProvider } from "./types.ts";

const registry = new Map<ProviderId, MusicProvider>();

export class UnknownProviderError extends Error {
  constructor(id: string) {
    super(`No adapter registered for provider "${id}".`);
    this.name = "UnknownProviderError";
  }
}

export function registerProvider(provider: MusicProvider): void {
  registry.set(provider.id, provider);
}

/** Throws rather than returning undefined: a missing adapter is a wiring bug. */
export function getProvider(id: ProviderId): MusicProvider {
  const provider = registry.get(id);
  if (!provider) throw new UnknownProviderError(id);
  return provider;
}

/** Adapters that are actually wired up, in a stable order for the connect UI. */
export function listProviders(): MusicProvider[] {
  return PROVIDER_IDS.map((id) => registry.get(id)).filter(
    (provider): provider is MusicProvider => provider !== undefined,
  );
}

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}
