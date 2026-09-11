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
  /** Other hosts serving the *same* image, tried in order when `artworkUrl` fails.
   *
   * Only Audius populates this, and it is not defensiveness: its artwork lives on whichever
   * content node holds the track, and those flap individually. Measured — of the three
   * mirrors one track advertised, one answered `200`, one `503` and one `502`. The image is
   * content-addressed, so every mirror serves byte-identical bytes and any of them will do. */
  artworkFallbacks?: string[];
  playback: Playback;
  /** YouTube Music's upload kind — `_ATV` (Topic art track), `_OMV`, `_UGC`. Art tracks
   * measured barred from embedding ~7% of the time, official videos never, hence the ranker. */
  videoType?: string | null;
  /**
   * A thirty-second clip the catalogue publishes itself, for songs nothing else can play.
   *
   * Deezer answers `preview` and Apple answers `previewUrl` on the same search responses
   * Timbre already reads for metadata — no key, no second request, and a field whose entire
   * purpose is to be played. It is the last rung of the fall-through ladder and never
   * competes with a full copy: `playback` stays `link`, so nothing about ranking or
   * auto-advance changes, and it is reached only when every real source has refused.
   */
  previewUrl?: string | null;
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
  /** Mirrors for {@link artworkUrl}, from whichever source supplied it. */
  artworkFallbacks?: string[];
  /** Every source carrying this recording, best playback option first. */
  sources: SourceTrack[];
}

/** Where to start a radio, carrying every handle a source might need: YouTube Music continues
 * from an upload, Deezer can only start from an artist, and Audius can only usefully start
 * from a **title** — its user search matches "The Weeknd" to "Louis The Child", so an
 * artist seed there is confidently wrong rather than merely empty. */
export interface RadioSeed {
  sourceId?: string;
  artist?: string;
  title?: string;
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
  /** Where a failure nobody sees is reported — a radio source that failed renders as nothing
   * at all. A function rather than a logger so this package stays free of the app's: the web
   * app passes its JSON logger, and omitted means `console.warn`, so a script still hears it. */
  report?: (event: string, fields: Record<string, unknown>) => void;
}

export interface SearchProvider {
  readonly id: SourceId;
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
