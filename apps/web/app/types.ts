export interface SourceTrack {
  source: string;
  sourceId: string;
  url: string | null;
  playback: "queue" | "manual" | "link";
  previewUrl?: string | null;
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
  artworkFallbacks?: string[];
  sources: SourceTrack[];
  from?: PlayContext;
}

export interface PlayContext {
  kind: "artist";
  name: string;
  imageUrl: string | null;
}

export interface SongsResponse {
  songs: Song[];
  /**
   * Which sources refused, and nothing else. `publicFailures()` in `lib/api.ts` strips the
   * message on the way out on purpose — it is upstream text and can carry the query back — so
   * declaring one here described a field no response has ever held. `search-results.tsx` read
   * it and logged the word "undefined" after every refusal until the reader was told otherwise.
   */
  failures: { source: string }[];
  attempted?: number;
}
