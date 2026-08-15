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
}

export interface Song {
  id: string;
  title: string;
  artists: string[];
  album: string | null;
  durationMs: number | null;
  isrc: string | null;
  artworkUrl: string | null;
  sources: SourceTrack[];
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
