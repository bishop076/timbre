import { recommend, type SongIdentity } from "./recommend.ts";
import {
  PLAYBACK_RANK,
  SOURCE_IDS,
  type RadioSeed,
  type RankedList,
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
  return SOURCE_IDS.map((id) => registry.get(id)).filter(
    (provider): provider is SearchProvider => provider !== undefined,
  );
}

export function isSourceId(value: string): value is SourceId {
  return (SOURCE_IDS as readonly string[]).includes(value);
}

export interface SearchAllResult {
  tracks: SourceTrack[];
  failures: { source: SourceId; message: string }[];
  attempted: number;
}

export function interleaveByPlayability(
  results: { provider: SearchProvider; tracks: SourceTrack[] }[],
): SourceTrack[] {
  const tiers = new Map<number, SourceTrack[][]>();
  for (const { provider, tracks } of results) {
    if (tracks.length === 0) continue;
    const rank = PLAYBACK_RANK[provider.playback];
    const tier = tiers.get(rank) ?? [];
    tier.push(tracks);
    tiers.set(rank, tier);
  }

  const out: SourceTrack[] = [];
  for (const rank of [...tiers.keys()].sort((a, b) => a - b)) {
    const lists = tiers.get(rank)!;
    const deepest = Math.max(...lists.map((list) => list.length));
    for (let i = 0; i < deepest; i++) {
      for (const list of lists) {
        const track = list[i];
        if (track) out.push(track);
      }
    }
  }
  return out;
}

export async function searchAll(
  ctx: SearchContext,
  query: string,
  limit: number,
): Promise<SearchAllResult> {
  const providers = listProviders().filter((provider) => provider.searchable);

  const settled = await Promise.allSettled(
    providers.map((provider) => provider.search(ctx, query, limit)),
  );

  const answered: { provider: SearchProvider; tracks: SourceTrack[] }[] = [];
  const failures: SearchAllResult["failures"] = [];

  settled.forEach((result, index) => {
    const provider = providers[index]!;
    if (result.status === "fulfilled") {
      answered.push({ provider, tracks: result.value });
    } else {
      failures.push({
        source: provider.id,
        message: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  });

  return { tracks: interleaveByPlayability(answered), failures, attempted: providers.length };
}

export async function resolveUrl(ctx: SearchContext, url: string): Promise<SourceTrack | null> {
  for (const provider of listProviders()) {
    if (!provider.resolve) continue;
    try {
      const track = await provider.resolve(ctx, url);
      if (track) return track;
    } catch {
    }
  }
  return null;
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

  const lists: RankedList[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      lists.push(...result.value);
    } else {
      const provider = providers[index]!;
      if (ctx.signal?.aborted) return;
      if (ctx.report) ctx.report("radio_failed", { source: provider.id, error: result.reason });
      else console.warn(`[timbre] ${provider.id} radio failed:`, result.reason);
    }
  });

  return recommend(lists, { limit, exclude });
}

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

  return { tracks, failures, attempted: providers.length };
}
