import { PROVIDER_IDS, type CanonicalTrack, type ProviderId, type RateLimiter } from "@timbre/core";

export const SOURCE_IDS = PROVIDER_IDS;
export type SourceId = ProviderId;

export type Playback = "queue" | "manual" | "link";

export interface SourceTrack extends CanonicalTrack {
  source: SourceId;
  sourceId: string;
  url: string | null;
  artworkUrl: string | null;
  artworkFallbacks?: string[];
  playback: Playback;
  videoType?: string | null;
  previewUrl?: string | null;
}

export interface Song {
  id: string;
  title: string;
  artists: string[];
  album: string | null;
  durationMs: number | null;
  isrc: string | null;
  artworkUrl: string | null;
  artworkFallbacks?: string[];
  sources: SourceTrack[];
}

export interface RadioSeed {
  sourceId?: string;
  artist?: string;
  title?: string;
}

export interface RankedList {
  list: string;
  tracks: SourceTrack[];
}

export interface SearchContext {
  limiter: RateLimiter;
  signal?: AbortSignal;
  revalidate?: number;
  report?: (event: string, fields: Record<string, unknown>) => void;
}

export interface SearchProvider {
  readonly id: SourceId;
  readonly playback: Playback;
  readonly searchable: boolean;

  search(ctx: SearchContext, query: string, limit: number): Promise<SourceTrack[]>;

  resolve?(ctx: SearchContext, url: string): Promise<SourceTrack | null>;

  chart?(ctx: SearchContext, limit: number): Promise<SourceTrack[]>;

  radio?(ctx: SearchContext, seed: RadioSeed, limit: number): Promise<RankedList[]>;
}

export const PLAYBACK_RANK: Record<Playback, number> = {
  queue: 0,
  manual: 1,
  link: 2,
};

export function byPlayability(a: SourceTrack, b: SourceTrack): number {
  return PLAYBACK_RANK[a.playback] - PLAYBACK_RANK[b.playback];
}
