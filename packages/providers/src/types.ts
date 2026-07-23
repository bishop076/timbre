/**
 * The seam the whole app is built on.
 *
 * Every service difference — Spotify's removed batch endpoints, YouTube's unit
 * quota, SoundCloud's pagination style — is absorbed by an adapter. Nothing
 * above this layer branches on `provider.id`.
 *
 * Phase 1 implements only the read half. The write half is declared now, and
 * optional, so Phase 2 is additive rather than a refactor: a provider that
 * cannot yet write simply omits those methods, and `canWrite()` reports it.
 */

import type {
  CredentialMode,
  Page,
  ProviderId,
  ProviderPlaylist,
  ProviderRef,
  ProviderTrack,
  TrackQuery,
} from "@timbre/core";
import type { RateLimiter } from "@timbre/core";

/** OAuth client credentials. For BYO providers these belong to the end user. */
export interface ClientCredentials {
  clientId: string;
  /** Null for public clients that use PKCE instead of a secret. */
  clientSecret: string | null;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string | null;
  /** Null when the provider issues non-expiring tokens. */
  expiresAt: Date | null;
  scope: string | null;
}

/**
 * Everything an adapter call needs. Built per request by the web app after it
 * decrypts the connection row.
 *
 * The limiter is keyed by connection, not by provider: under BYO credentials
 * each user is spending their own quota, so one user's heavy sync must not
 * throttle everyone else.
 */
export interface ProviderContext {
  connectionId: string;
  accessToken: string;
  credentials: ClientCredentials;
  limiter: RateLimiter;
  /** Aborts in-flight requests when a sync job is cancelled. */
  signal?: AbortSignal;
}

export interface AuthorizeInput {
  credentials: ClientCredentials;
  redirectUri: string;
  /** CSRF token; echoed back on the callback and verified before exchange. */
  state: string;
}

export interface ExchangeInput extends AuthorizeInput {
  code: string;
}

export interface RefreshInput {
  credentials: ClientCredentials;
  refreshToken: string;
}

export interface AuthDriver {
  /** Minimum scopes for the read-only MVP. Kept narrow deliberately. */
  readonly scopes: readonly string[];
  authorizeUrl(input: AuthorizeInput): string;
  exchangeCode(input: ExchangeInput): Promise<Tokens>;
  refresh(input: RefreshInput): Promise<Tokens>;
}

/**
 * Copy and links driving the BYO onboarding wizard. This lives beside the
 * adapter because the setup steps are as provider-specific as the API calls,
 * and asking a user to register a developer app is the app's biggest drop-off
 * point — it deserves first-class, per-provider guidance rather than one
 * generic form.
 */
export interface ByoSetupGuide {
  /** Where the user creates their app. */
  consoleUrl: string;
  /** Ordered, human-readable instructions rendered in the wizard. */
  steps: string[];
  /** Whether the user must also copy a client secret. */
  requiresSecret: boolean;
  /** Prerequisites to state up front, not after four steps of setup. */
  warnings?: string[];
}

export interface MusicProvider {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly credentialMode: CredentialMode;
  readonly auth: AuthDriver;
  /** Present only when `credentialMode` is `byo`. */
  readonly setupGuide?: ByoSetupGuide;

  // ---- Read (Phase 1) ----

  listLikedTracks(ctx: ProviderContext, cursor?: string): Promise<Page<ProviderTrack>>;
  listPlaylists(ctx: ProviderContext, cursor?: string): Promise<Page<ProviderPlaylist>>;
  listPlaylistTracks(
    ctx: ProviderContext,
    playlistId: string,
    cursor?: string,
  ): Promise<Page<ProviderTrack>>;

  // ---- Write (Phase 2) ----

  /**
   * Note for implementers: Spotify caps search at 10 results per request as of
   * Feb 2026, so the matcher issues several narrow queries rather than reading
   * deep into one broad result list.
   */
  search?(ctx: ProviderContext, query: TrackQuery, limit: number): Promise<ProviderTrack[]>;
  createPlaylist?(
    ctx: ProviderContext,
    input: { name: string; description?: string; isPublic?: boolean },
  ): Promise<ProviderRef>;
  addTracks?(ctx: ProviderContext, playlistId: string, providerIds: string[]): Promise<void>;
}

/** A provider that has its Phase 2 write half implemented. */
export type WritableProvider = MusicProvider &
  Required<Pick<MusicProvider, "search" | "createPlaylist" | "addTracks">>;

/** Narrows a provider to one that can be a transfer destination. */
export function canWrite(provider: MusicProvider): provider is WritableProvider {
  return (
    typeof provider.search === "function" &&
    typeof provider.createPlaylist === "function" &&
    typeof provider.addTracks === "function"
  );
}

/** Async-iterates every page, so callers do not hand-roll cursor loops. */
export async function* paginate<T>(
  fetchPage: (cursor?: string) => Promise<Page<T>>,
  startCursor?: string,
): AsyncGenerator<{ items: T[]; cursor: string | null }> {
  let cursor = startCursor;
  for (;;) {
    const page = await fetchPage(cursor);
    yield { items: page.items, cursor: page.cursor };
    if (page.cursor === null) return;
    cursor = page.cursor;
  }
}

export type { ProviderId, CredentialMode };
