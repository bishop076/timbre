/**
 * Client-side mirrors of the shapes returned by /api/search and /api/charts.
 *
 * Declared separately from @timbre/providers rather than imported: these cross
 * the network as JSON, so they are a wire contract, and a client component
 * should not pull in the server-only provider package to describe it.
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
}
