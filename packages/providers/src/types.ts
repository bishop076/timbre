/** The seam the whole app is built on: each service's differences are absorbed by an
 * adapter, so nothing above this layer branches on which service a track came from. */

import { PROVIDER_IDS, type CanonicalTrack, type ProviderId, type RateLimiter } from "@timbre/core";

/** Re-exported from @timbre/core so there is one list of sources, not two. */
export const SOURCE_IDS = PROVIDER_IDS;
export type SourceId = ProviderId;

/** How Timbre can play a source, dictated by terms and embed tech: `queue` auto-advances
 * under script, `manual` embeds but cannot be started by one (Spotify's embed exposes no
 * play API, which also keeps it clear of Developer Terms §IV.2), `link` cannot embed. */
export type Playback = "queue" | "manual" | "link";

/** One service's copy of a recording. */
export interface SourceTrack extends CanonicalTrack {
  source: SourceId;
  /** The service's own identifier. Opaque; format differs per source. */
  sourceId: string;
  url: string | null;
  artworkUrl: string | null;
  playback: Playback;
  isExplicit: boolean;
  /** YouTube Music's upload kind — `_ATV` (Topic art track), `_OMV`, `_UGC`. Art tracks
   * measured barred from embedding ~7% of the time, official videos never, hence the ranker. */
  videoType?: string | null;
}

/** A recording with every source that has it — what the queue holds, so the controller can
 * pick the best `queue`-capable source at play time. */
export interface Song {
  /** Stable id derived from ISRC or the matcher's dedupe key. */
  id: string;
  title: string;
  artists: string[];
  album: string | null;
  durationMs: number | null;
  isrc: string | null;
  artworkUrl: string | null;
  /** Every source carrying this recording, best playback option first. */
  sources: SourceTrack[];
}

/** Where to start a radio: YouTube Music continues from an upload, Deezer only from an artist. */
export interface RadioSeed {
  sourceId?: string;
  artist?: string;
}

/** One source's suggestions, kept separate because agreement between lists is the signal. */
export interface RankedList {
  /** Stable identifier for the list, e.g. "ytmusic:radio". Diagnostics only. */
  list: string;
  tracks: SourceTrack[];
}

export interface SearchContext {
  limiter: RateLimiter;
  signal?: AbortSignal;
  /** How long Next may cache the upstream responses. Omitted means `no-store`, right for a
   * route handler but wrong for a server component: one `no-store` fetch anywhere in a render
   * opts the whole route out of static generation, as `/explore` found despite `revalidate`. */
  revalidate?: number;
}

export interface SearchProvider {
  readonly id: SourceId;
  readonly displayName: string;
  /** How Timbre can play this source's tracks, if at all. */
  readonly playback: Playback;
  /** False when the catalogue cannot be searched — SoundCloud's is gated. Still contributes
   * through `resolve`. */
  readonly searchable: boolean;

  search(ctx: SearchContext, query: string, limit: number): Promise<SourceTrack[]>;

  /** Turns a pasted URL into a track. The only way to reach SoundCloud today. */
  resolve?(ctx: SearchContext, url: string): Promise<SourceTrack | null>;

  /** What's popular right now. Optional: YouTube Music publishes no keyless chart. */
  chart?(ctx: SearchContext, limit: number): Promise<SourceTrack[]>;

  /** What this source would play next. Optional: Apple has no related endpoint at all, and
   * abstaining counts as no evidence rather than a negative. */
  radio?(ctx: SearchContext, seed: RadioSeed, limit: number): Promise<RankedList[]>;
}

/** Ordering used when choosing which source actually plays a song. */
export const PLAYBACK_RANK: Record<Playback, number> = {
  queue: 0,
  manual: 1,
  link: 2,
};

/** Sorts sources so the most playable option comes first. */
export function byPlayability(a: SourceTrack, b: SourceTrack): number {
  return PLAYBACK_RANK[a.playback] - PLAYBACK_RANK[b.playback];
}
