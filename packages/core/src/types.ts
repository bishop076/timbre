/**
 * Canonical models. Every provider adapter normalizes into these shapes so that
 * nothing above the adapter layer has to branch on which service a track came from.
 */

/**
 * Every service Timbre knows about. Ordered by how useful each is to the
 * product: sources it can actually play come first.
 */
export const PROVIDER_IDS = ["ytmusic", "soundcloud", "audius", "archive", "spotify", "deezer", "apple"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** A recording, independent of which service it lives on. */
export interface CanonicalTrack {
  /** International Standard Recording Code. The only globally reliable join key. */
  isrc: string | null;
  title: string;
  artists: string[];
  album: string | null;
  durationMs: number | null;
}
