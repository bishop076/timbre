export const PROVIDER_IDS = ["ytmusic", "soundcloud", "audius", "mixcloud", "archive", "spotify", "deezer", "apple"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface CanonicalTrack {
  isrc: string | null;
  title: string;
  artists: string[];
  album: string | null;
  durationMs: number | null;
}
