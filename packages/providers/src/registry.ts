/**
 * Provider registry.
 *
 * Sources are registered at startup and searched together. A source that fails
 * must never blank the page — one service being down is normal, and Timbre's
 * whole point is that there is more than one.
 */

import { SOURCE_IDS, type ArtistInfo, type SearchContext, type SearchProvider, type SourceId, type SourceTrack } from "./types.ts";

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
 * Turns a pasted URL into a track, by asking each provider that can resolve.
 *
 * This is how SoundCloud gets in at all: its catalogue cannot be searched, so a
 * URL is the only entry point. Providers are tried in registry order and the
 * first match wins.
 *
 * **Failures are swallowed on purpose.** A provider handed a URL belonging to a
 * different service is expected to reject it — the YouTube Music sidecar answers
 * 400 for anything that is not a YouTube URL — and that is a non-answer, not an
 * error worth surfacing. Only a URL that no provider claims is a real failure,
 * and that is reported as `null`.
 */
export async function resolveUrl(ctx: SearchContext, url: string): Promise<SourceTrack | null> {
  for (const provider of listProviders()) {
    if (!provider.resolve) continue;
    try {
      const track = await provider.resolve(ctx, url);
      if (track) return track;
    } catch {
      // Wrong provider for this URL, or that service is briefly unavailable.
      // Either way, try the next one.
    }
  }
  return null;
}

/**
 * Who an artist is, from the first provider that can say.
 *
 * Same shape and same reasoning as {@link resolveUrl}: a provider with no
 * answer is not a failure, so it falls through to the next rather than
 * surfacing an error for something the panel can simply omit.
 */
export async function lookupArtist(ctx: SearchContext, name: string): Promise<ArtistInfo | null> {
  for (const provider of listProviders()) {
    if (!provider.artist) continue;
    try {
      const info = await provider.artist(ctx, name);
      if (info) return info;
    } catch {
      // That source is briefly unavailable; an artist card is not worth failing
      // the page over.
    }
  }
  return null;
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
