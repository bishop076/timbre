/**
 * Canonical models. Every provider adapter normalizes into these shapes so that
 * nothing above the adapter layer has to branch on which service a track came from.
 */

export const PROVIDER_IDS = ["spotify", "ytmusic", "soundcloud"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/**
 * How a provider's API credentials are obtained.
 *
 * - `byo`    the end user registers their own developer app and supplies the
 *            client id/secret. Required for Spotify (5-user cap on a central
 *            app) and YouTube (per-project daily quota).
 * - `central` Timbre holds one set of credentials for all users. SoundCloud
 *            only, where self-service registration is open.
 */
export type CredentialMode = "byo" | "central";

/** A recording, independent of which service it lives on. */
export interface CanonicalTrack {
  /** International Standard Recording Code. The only globally reliable join key. */
  isrc: string | null;
  title: string;
  artists: string[];
  album: string | null;
  durationMs: number | null;
}

/** Where a canonical track lives on one specific service. */
export interface ProviderRef {
  provider: ProviderId;
  /** The service's own identifier. Opaque; format differs per provider. */
  providerId: string;
  /** Public URL to open the item in that service, when one exists. */
  url: string | null;
}

export interface ProviderTrack extends CanonicalTrack {
  ref: ProviderRef;
  /** When the user saved it, ISO 8601. Null when the provider does not report it. */
  addedAt: string | null;
}

export interface ProviderPlaylist {
  ref: ProviderRef;
  name: string;
  description: string | null;
  /** Null when the provider does not report a count without fetching every page. */
  trackCount: number | null;
  /** False for followed/subscribed playlists the user did not create. */
  isOwned: boolean;
  imageUrl: string | null;
}

/**
 * One page of results. `cursor` is an opaque provider-specific continuation
 * token; null means the final page. It is persisted verbatim into `sync_runs`
 * so an interrupted ingest resumes instead of restarting.
 */
export interface Page<T> {
  items: T[];
  cursor: string | null;
}

/** A track we are trying to locate on another service. Phase 2. */
export interface TrackQuery {
  isrc: string | null;
  title: string;
  artists: string[];
  album: string | null;
  durationMs: number | null;
}
