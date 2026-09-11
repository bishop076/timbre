import type { SearchProvider, SourceTrack } from "./types.ts";
import { cachePolicy } from "./cache-policy.ts";
import { createRequester } from "./request.ts";

interface ITunesTrack {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  trackTimeMillis?: number;
  artworkUrl100?: string;
  trackViewUrl?: string;
  previewUrl?: string;
  trackExplicitness?: string;
}

interface RssEntry {
  id?: string;
  name?: string;
  artistName?: string;
  artworkUrl100?: string;
  url?: string;
}

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
    previewUrl: raw.previewUrl || null,
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
    durationMs: null,
    isrc: null,
    url: raw.url ?? null,
    artworkUrl: upsizeArtwork(raw.artworkUrl100),
    playback: "link",
  };
}

export interface AppleConfig {
  country?: string;
}

const get = createRequester({
  id: "apple",
  label: "Apple Music",
  init: cachePolicy,
  classify: (status) => (status === 403 ? "rate_limited" : "transient"),
});

export function createAppleProvider(config: AppleConfig = {}): SearchProvider {
  const country = config.country ?? "us";

  return {
    id: "apple",
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
