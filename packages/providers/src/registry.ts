/**
 * Provider registry.
 *
 * Sources are registered at startup and searched together. A source that fails
 * must never blank the page — one service being down is normal, and Timbre's
 * whole point is that there is more than one.
 */

import { SOURCE_IDS, type SearchContext, type SearchProvider, type SourceId, type SourceTrack } from "./types.ts";

const registry = new Map<SourceId, SearchProvider>();

export class UnknownSourceError extends Error {
  constructor(id: string) {
    super(`No provider registered for source "${id}".`);
    this.name = "UnknownSourceError";
  }
}

export function registerProvider(provider: SearchProvider): void {
  registry.set(provider.id, provider);
}

export function getProvider(id: SourceId): SearchProvider {
  const provider = registry.get(id);
  if (!provider) throw new UnknownSourceError(id);
  return provider;
}

/** Registered providers, in a stable order with the primary source first. */
export function listProviders(): SearchProvider[] {
  return SOURCE_IDS.map((id) => registry.get(id)).filter(
    (provider): provider is SearchProvider => provider !== undefined,
  );
}

export function isSourceId(value: string): value is SourceId {
  return (SOURCE_IDS as readonly string[]).includes(value);
}

export interface SearchAllResult {
  tracks: SourceTrack[];
  /** Sources that failed, so the UI can say "Deezer is down" rather than lie. */
  failures: { source: SourceId; message: string }[];
}

/**
 * Searches every searchable provider concurrently.
 *
 * Results are concatenated in registry order — primary source first — because
 * {@link mergeTracks} preserves input order, and relevance from the source the
 * user will actually hear should drive the final ordering.
 */
export async function searchAll(
  ctx: SearchContext,
  query: string,
  limit: number,
): Promise<SearchAllResult> {
  const providers = listProviders().filter((provider) => provider.searchable);

  const settled = await Promise.allSettled(
    providers.map((provider) => provider.search(ctx, query, limit)),
  );

  const tracks: SourceTrack[] = [];
  const failures: SearchAllResult["failures"] = [];

  settled.forEach((result, index) => {
    const provider = providers[index]!;
    if (result.status === "fulfilled") {
      tracks.push(...result.value);
    } else {
      failures.push({
        source: provider.id,
        message: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  });

  return { tracks, failures };
}

/**
 * What's popular right now, for the home page.
 *
 * Only some sources publish a chart without credentials — YouTube Music does
 * not — so this draws from whichever can, and merging turns the overlap into
 * one entry per song.
 */
export async function chartAll(ctx: SearchContext, limit: number): Promise<SearchAllResult> {
  const providers = listProviders().filter((provider) => provider.chart !== undefined);

  const settled = await Promise.allSettled(
    providers.map((provider) => provider.chart!(ctx, limit)),
  );

  const tracks: SourceTrack[] = [];
  const failures: SearchAllResult["failures"] = [];

  settled.forEach((result, index) => {
    const provider = providers[index]!;
    if (result.status === "fulfilled") {
      tracks.push(...result.value);
    } else {
      failures.push({
        source: provider.id,
        message: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  });

  return { tracks, failures };
}
