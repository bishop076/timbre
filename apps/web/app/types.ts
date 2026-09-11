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
  failures: { source: string; message: string }[];
  attempted?: number;
}
