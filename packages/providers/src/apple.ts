/**
 * Apple Music, via the public iTunes Search API and the Marketing Tools RSS
 * feeds.
 *
 * Needs **no API key of any kind** — not even a registration — which is rare.
 * The trade-off is the tightest rate limit of any source: roughly 20 requests
 * per minute per IP, answered with a 403 rather than a 429, so the limiter
 * policy for `apple` is deliberately miserly.
 *
 * No ISRC is exposed, so Apple contributes availability and artwork rather
 * than identity. Timbre cannot play Apple audio, so tracks are `link`.
 */

import { DEFAULT_POLICIES, ProviderError } from "@timbre/core";

import type { SearchContext, SearchProvider, SourceTrack } from "./types.ts";

interface ITunesTrack {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  trackTimeMillis?: number;
  artworkUrl100?: string;
  trackViewUrl?: string;
  trackExplicitness?: string;
}

interface RssEntry {
  id?: string;
  name?: string;
  artistName?: string;
  artworkUrl100?: string;
  url?: string;
}

/**
 * Apple serves artwork at whatever size the URL asks for. The feeds hand back
 * 100×100, which is visibly soft on a modern display.
 */
function upsizeArtwork(url: string | undefined, size = 400): string | null {
  if (!url) return null;
  return url.replace(/\/\d+x\d+bb\./, `/${size}x${size}bb.`);
}

function fromSearch(raw: ITunesTrack): SourceTrack | null {
  if (!raw.trackId || !raw.trackName) return null;
  return {
    source: "apple",
    sourceId: String(raw.trackId),
    title: raw.trackName,
    artists: raw.artistName ? [raw.artistName] : [],
    album: raw.collectionName ?? null,
    durationMs: raw.trackTimeMillis ?? null,
    isrc: null,
    url: raw.trackViewUrl ?? null,
    artworkUrl: upsizeArtwork(raw.artworkUrl100),
    playback: "link",
    isExplicit: raw.trackExplicitness === "explicit",
  };
}

function fromRss(raw: RssEntry): SourceTrack | null {
  if (!raw.id || !raw.name) return null;
  return {
    source: "apple",
    sourceId: raw.id,
    title: raw.name,
    artists: raw.artistName ? [raw.artistName] : [],
    album: null,
    // The RSS feeds carry no duration; the matcher tolerates a null rather
    // than treating it as a mismatch.
    durationMs: null,
    isrc: null,
    url: raw.url ?? null,
    artworkUrl: upsizeArtwork(raw.artworkUrl100),
    playback: "link",
    isExplicit: false,
  };
}

export interface AppleConfig {
  /** Storefront country code. Charts and availability differ by market. */
  country?: string;
}

export function createAppleProvider(config: AppleConfig = {}): SearchProvider {
  const country = config.country ?? "us";

  async function get<T>(ctx: SearchContext, url: string): Promise<T> {
    await ctx.limiter.acquire("apple", DEFAULT_POLICIES.apple);

    let response: Response;
    try {
      response = await fetch(url, { signal: ctx.signal, cache: "no-store" });
    } catch (cause) {
      throw new ProviderError("apple", "transient", "Apple Music unreachable.", { cause });
    }

    if (!response.ok) {
      // Apple answers an exceeded rate limit with 403, so it is treated as a
      // throttle rather than as a permission problem.
      throw new ProviderError(
        "apple",
        response.status === 403 ? "rate_limited" : "transient",
        `Apple Music returned ${response.status}.`,
        { status: response.status },
      );
    }

    return (await response.json()) as T;
  }

  return {
    id: "apple",
    displayName: "Apple Music",
    playback: "link",
    searchable: true,

    async search(ctx, query, limit) {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&country=${country}&limit=${limit}`;
      const data = await get<{ results?: ITunesTrack[] }>(ctx, url);
      return (data.results ?? []).map(fromSearch).filter((track): track is SourceTrack => track !== null);
    },

    async chart(ctx, limit) {
      const url = `https://rss.marketingtools.apple.com/api/v2/${country}/music/most-played/${limit}/songs.json`;
      const data = await get<{ feed?: { results?: RssEntry[] } }>(ctx, url);
      return (data.feed?.results ?? []).map(fromRss).filter((track): track is SourceTrack => track !== null);
    },
  };
}
