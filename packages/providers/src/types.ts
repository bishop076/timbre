/**
 * The seam the whole app is built on.
 *
 * Timbre is a shell around other services' players. Each service differs in
 * what it can do — some can be searched, some can be played in-app, some only
 * linked to — and every one of those differences is absorbed by an adapter so
 * that nothing above this layer branches on which service a track came from.
 */

import { PROVIDER_IDS, type CanonicalTrack, type ProviderId, type RateLimiter } from "@timbre/core";

/** Re-exported from @timbre/core so there is one list of sources, not two. */
export const SOURCE_IDS = PROVIDER_IDS;
export type SourceId = ProviderId;

/**
 * How Timbre can play a source, which is dictated by that service's terms and
 * embed technology rather than by preference.
 *
 * - `queue`  Programmatically controllable, so it can sit in the queue and
 *            auto-advance. YouTube Music and SoundCloud.
 * - `manual` Embeddable but cannot be started by script, so the user must
 *            click it. Spotify — its embed exposes no play API, which also
 *            keeps it clear of Developer Terms §IV.2 on blending streams.
 * - `link`   Not embeddable at all; Timbre links out. Deezer, Apple.
 */
export type Playback = "queue" | "manual" | "link";

/** One service's copy of a recording. */
export interface SourceTrack extends CanonicalTrack {
  source: SourceId;
  /** The service's own identifier. Opaque; format differs per source. */
  sourceId: string;
  /** Public URL to open the track in that service. */
  url: string | null;
  artworkUrl: string | null;
  playback: Playback;
  isExplicit: boolean;
  /**
   * YouTube Music's upload kind — `MUSIC_VIDEO_TYPE_ATV` (auto-generated Topic
   * art track), `_OMV` (official video), `_UGC` (user upload).
   *
   * Only YouTube Music reports one, and it is the only source Timbre can
   * actually play, so it is the only place this is meaningful. Art tracks were
   * measured barred from embedding ~7% of the time and official videos never
   * were, which is why the recommendation ranker reads it.
   */
  videoType?: string | null;
}

/**
 * A recording, with every source that has it.
 *
 * This is what the queue holds — a *song*, not a source-track. When it plays,
 * the controller picks the best `queue`-capable source. That indirection is
 * only possible because the matcher in @timbre/core can tell that two results
 * from different services are the same recording.
 */
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

/**
 * Who made the recording.
 *
 * Deliberately thin, and every field is something a keyless source actually
 * publishes. There is no bio here because no free source gives one, and a
 * plausible-sounding paragraph about a real musician is not something to
 * invent.
 */
export interface ArtistInfo {
  name: string;
  imageUrl: string | null;
  /** Followers on the source that answered, and which source that was. */
  followers: number | null;
  source: SourceId;
  url: string | null;
}

/**
 * Where to start a radio.
 *
 * Two fields because sources start from different things: YouTube Music
 * continues from a specific upload, while Deezer can only start from an
 * artist. A provider takes whichever it can use and ignores the rest.
 */
export interface RadioSeed {
  /** This source's own id for the seed track, when it has a copy of it. */
  sourceId?: string;
  /** The seed's primary artist, for sources that cannot start from a track. */
  artist?: string;
}

/**
 * One source's suggestions, in the order that source ranked them.
 *
 * Lists are kept separate rather than concatenated because **agreement between
 * independent lists is the signal** — see `recommend.ts`. A source may return
 * several, as YouTube Music does: its sequential watch queue and its "you might
 * also like" panel are derived differently and genuinely disagree.
 */
export interface RankedList {
  /** Stable identifier for the list, e.g. "ytmusic:radio". Diagnostics only. */
  list: string;
  tracks: SourceTrack[];
}

export interface SearchContext {
  limiter: RateLimiter;
  signal?: AbortSignal;
}

export interface SearchProvider {
  readonly id: SourceId;
  readonly displayName: string;
  /** How Timbre can play this source's tracks, if at all. */
  readonly playback: Playback;
  /**
   * False when the service's catalogue cannot be searched — SoundCloud, whose
   * playback is free but whose search API is gated. Such a provider still
   * contributes through `resolve`.
   */
  readonly searchable: boolean;

  search(ctx: SearchContext, query: string, limit: number): Promise<SourceTrack[]>;

  /** Turns a pasted URL into a track. The only way to reach SoundCloud today. */
  resolve?(ctx: SearchContext, url: string): Promise<SourceTrack | null>;

  /**
   * What's popular right now, for the home page. Optional because not every
   * source publishes a chart without credentials — YouTube Music does not.
   */
  chart?(ctx: SearchContext, limit: number): Promise<SourceTrack[]>;

  /** Who the artist is. Optional; only Deezer publishes this without a key. */
  artist?(ctx: SearchContext, name: string): Promise<ArtistInfo | null>;

  /**
   * What this source would play next, as one or more ranked lists.
   *
   * Optional because it needs a service that publishes a continuation without
   * credentials. YouTube Music and Deezer both do; **Apple has no related or
   * similar endpoint at all**, and SoundCloud's catalogue cannot be reached.
   * Those two abstain rather than guessing, which the ranker treats as no
   * evidence rather than as a negative.
   */
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

/**
 * The source the queue controller should play, or null when a song has no
 * auto-playable copy — in which case the queue pauses and waits for the user
 * to click a `manual` source rather than silently skipping the song.
 */
export function playableSource(song: Song): SourceTrack | null {
  return song.sources.find((source) => source.playback === "queue") ?? null;
}
