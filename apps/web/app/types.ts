/*
 * Client-side mirrors of what /api/search and /api/charts return. Re-declared rather than
 * imported from @timbre/providers: they cross the network as JSON, so they are a wire
 * contract, and a client component must not pull in a server-only package to describe one.
 */

export interface SourceTrack {
  source: string;
  sourceId: string;
  url: string | null;
  playback: "queue" | "manual" | "link";
  /** A thirty-second clip the catalogue publishes, played only when nothing else will.
   * Mirrors `SourceTrack.previewUrl` in `@timbre/providers`, which is server-only. */
  previewUrl?: string | null;
  /** A YouTube upload's kind — `MUSIC_VIDEO_TYPE_ATV` for an art track. Sent by search all
   * along and first read by the lyrics panel; absent on songs saved without it. */
  videoType?: string | null;
}

export interface Song {
  id: string;
  title: string;
  artists: string[];
  album: string | null;
  durationMs: number | null;
  isrc: string | null;
  artworkUrl: string | null;
  /** Other hosts serving the same image — Audius content nodes flap individually, so the
   * cover falls through them rather than showing a broken frame. */
  artworkFallbacks?: string[];
  sources: SourceTrack[];
  /** The page this song was queued from, when it is worth going back to. Browser-only —
   * never sent by or to the server — and set only by the page that queued it. */
  from?: PlayContext;
}

/**
 * Where a queue was started. An artist page tags its songs with the artist, so a run of them
 * lands in "Recently played" as that artist rather than as a row of their songs — the way
 * every service shows what you played *from*, not only what you played.
 */
export interface PlayContext {
  kind: "artist";
  name: string;
  imageUrl: string | null;
}

export interface SongsResponse {
  songs: Song[];
  failures: { source: string; message: string }[];
  /**
   * How many sources were asked. Optional — `/api/resolve` has no fan-out. When present,
   * `failures.length === attempted` means nothing was reachable, which is not "no results".
   */
  attempted?: number;
}
