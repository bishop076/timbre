/** Provider registry. Sources register at startup; one that fails must never blank the
 * page. */

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

/** Adds a source to the registry. */
export function registerProvider(provider: SearchProvider): void {
  registry.set(provider.id, provider);
}

/** Registered providers, in a stable order with the primary source first. */
export function listProviders(): SearchProvider[] {
  return SOURCE_IDS.map((id) => registry.get(id)).filter(
    (provider): provider is SearchProvider => provider !== undefined,
  );
}

/** Whether a string names a known source. */
export function isSourceId(value: string): value is SourceId {
  return (SOURCE_IDS as readonly string[]).includes(value);
}

export interface SearchAllResult {
  tracks: SourceTrack[];
  /** Sources that failed, so the UI can say "Deezer is down" rather than lie. */
  failures: { source: SourceId; message: string }[];
  /** How many providers were asked. Without it, "every source is down" and "none had
   * this song" are the same observation and need opposite messages. */
  attempted: number;
}

/**
 * Interleaves several sources' results into one list, **most playable tier first**.
 *
 * Concatenating instead — all of one source, then all of the next — is what this replaces,
 * and it was invisible for as long as the link-only sources merged away: Deezer and Apple
 * carry ISRCs, so their rows folded into the YouTube Music rows above them and never
 * appeared on their own. Audius carries none and its titles are all distinct remixes, so
 * nothing merged, and twenty rows landed in a block starting around **#21** — past the end
 * of what anyone scrolls. A source you cannot see is not a source.
 *
 * Round-robin within a tier, so each provider keeps its own relevance order and simply
 * takes turns. Tiers in `PLAYBACK_RANK` order, so a row you can press play on always
 * outranks one that can only link out — which is the same rule `byPlayability` already
 * applies *within* a merged song, applied here *between* them.
 */
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

/** Searches every searchable provider concurrently, interleaving the answers so no single
 * source owns the top of the list — {@link mergeTracks} preserves the order it is given. */
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

/** Turns a pasted URL into a track — the only entry point for SoundCloud, whose catalogue
 * cannot be searched. Failures are swallowed: a provider handed another service's URL
 * rejects it, which is a non-answer. Only a URL nobody claims is `null`. */
export async function resolveUrl(ctx: SearchContext, url: string): Promise<SourceTrack | null> {
  for (const provider of listProviders()) {
    if (!provider.resolve) continue;
    try {
      const track = await provider.resolve(ctx, url);
      if (track) return track;
    } catch {
      // Wrong provider for this URL, or briefly unavailable. Try the next.
    }
  }
  return null;
}

/** What to play next, drawn from every source that answers. Ranked lists are fused rather
 * than concatenated, so a song several lists reach outranks any one list's favourite. A
 * source that fails or abstains contributes nothing, and is not an error. */
export async function recommendFrom(
  ctx: SearchContext,
  seed: RadioSeed,
  limit: number,
  exclude?: Iterable<SongIdentity>,
): Promise<Song[]> {
  const providers = listProviders().filter((provider) => provider.radio !== undefined);

  const settled = await Promise.allSettled(
    // A full list from each: truncating before ranking discards the measured overlap.
    providers.map((provider) => provider.radio!(ctx, seed, limit)),
  );

  const lists: RankedList[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      lists.push(...result.value);
    } else {
      const provider = providers[index]!;
      // Not surfaced, unlike a failed search: a missing recommendation is invisible.
      console.warn(`[timbre] ${provider.id} radio failed:`, result.reason);
    }
  });

  return recommend(lists, { limit, exclude });
}

/** What's popular right now. Only some sources publish a chart without credentials —
 * YouTube Music does not — so this draws from whichever can. */
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
