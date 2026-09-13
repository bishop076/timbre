import { PROVIDER_IDS, ProviderError } from "@timbre/core";

import { recommend, type SongIdentity } from "./recommend.ts";
import {
  PLAYBACK_RANK,
  type RadioSeed,
  type SearchContext,
  type SearchProvider,
  type Song,
  type SourceId,
  type SourceTrack,
} from "./types.ts";

const registry = new Map<SourceId, SearchProvider>();

export function registerProvider(provider: SearchProvider): void {
  registry.set(provider.id, provider);
}

export function listProviders(): SearchProvider[] {
  return PROVIDER_IDS.flatMap((id) => registry.get(id) ?? []);
}

export interface SearchAllResult {
  tracks: SourceTrack[];
  failures: { source: SourceId; message: string }[];
  attempted: number;
}

type Answer = { provider: SearchProvider; tracks: SourceTrack[] };

export function interleaveByPlayability(results: Answer[]): SourceTrack[] {
  return results
    .flatMap(({ provider, tracks }, order) => {
      const tier = PLAYBACK_RANK[provider.playback];
      return tracks.map((track, round) => ({ track, tier, round, order }));
    })
    .sort((a, b) => a.tier - b.tier || a.round - b.round || a.order - b.order)
    .map(({ track }) => track);
}

async function collect(
  providers: SearchProvider[],
  ask: (provider: SearchProvider) => Promise<SourceTrack[]>,
  combine: (answered: Answer[]) => SourceTrack[],
): Promise<SearchAllResult> {
  const settled = await Promise.allSettled(providers.map(ask));
  const answered: Answer[] = [];
  const failures: SearchAllResult["failures"] = [];

  settled.forEach((result, index) => {
    const provider = providers[index]!;
    if (result.status === "fulfilled") {
      answered.push({ provider, tracks: result.value });
    } else {
      const { reason } = result;
      const message = reason instanceof Error ? reason.message : String(reason);
      failures.push({ source: provider.id, message });
    }
  });

  return { tracks: combine(answered), failures, attempted: providers.length };
}

export function searchAll(
  ctx: SearchContext,
  query: string,
  limit: number,
): Promise<SearchAllResult> {
  return collect(
    listProviders().filter((provider) => provider.searchable),
    (provider) => provider.search(ctx, query, limit),
    interleaveByPlayability,
  );
}

export function chartAll(ctx: SearchContext, limit: number): Promise<SearchAllResult> {
  return collect(
    listProviders().filter((provider) => provider.chart !== undefined),
    (provider) => provider.chart!(ctx, limit),
    (answered) => answered.flatMap((answer) => answer.tracks),
  );
}

/**
 * The track a link points at, or null when no provider claims it.
 *
 * `failures` separates the two things a null used to conflate. The empty `catch` meant a
 * SoundCloud link pasted while SoundCloud was 500ing — or while its bucket was drained, which
 * arrives as a `rate_limited` ProviderError and was swallowed identically — came back
 * indistinguishable from a link to a service Timbre does not support, and the caller told the
 * reader their link was the problem. Nothing was logged either, so the outage was invisible.
 */
export async function resolveUrl(
  ctx: SearchContext,
  url: string,
): Promise<{ track: SourceTrack | null; failures: { source: string; message: string }[] }> {
  const failures: { source: string; message: string }[] = [];

  for (const provider of listProviders()) {
    try {
      const track = await provider.resolve?.(ctx, url);
      if (track) return { track, failures };
    } catch (cause) {
      if (ctx.signal?.aborted) break;
      // Only an outage counts. A provider handed a URL that is not its own answers with a
      // refusal — the ytmusic sidecar 400s every link it does not recognise, and it is asked
      // about every link — so counting every throw would report "Timbre couldn't reach the
      // service" for a perfectly ordinary unsupported link, which is worse than the confusion
      // this set out to fix. `transient` and `rate_limited` are the two kinds that mean the
      // provider might have claimed this link on a better day.
      const outage =
        cause instanceof ProviderError &&
        (cause.kind === "transient" || cause.kind === "rate_limited");
      ctx.report?.(outage ? "resolve_failed" : "resolve_declined", {
        source: provider.id,
        error: cause,
      });
      if (outage) failures.push({ source: provider.id, message: cause.message });
    }
  }
  return { track: null, failures };
}

export async function recommendFrom(
  ctx: SearchContext,
  seed: RadioSeed,
  limit: number,
  exclude?: Iterable<SongIdentity>,
): Promise<Song[]> {
  const providers = listProviders().filter((provider) => provider.radio !== undefined);
  const settled = await Promise.allSettled(
    providers.map((provider) => provider.radio!(ctx, seed, limit)),
  );

  const lists = settled.flatMap((result, index) => {
    if (result.status === "fulfilled") return result.value;
    const source = providers[index]!.id;
    if (ctx.signal?.aborted) return [];
    if (ctx.report) ctx.report("radio_failed", { source, error: result.reason });
    else console.warn(`[timbre] ${source} radio failed:`, result.reason);
    return [];
  });

  return recommend(lists, { limit, exclude });
}
