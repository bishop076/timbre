/**
 * A provider-neutral error taxonomy. Adapters translate each service's own
 * failure vocabulary into these, so ingest and the UI can react to a failure
 * without knowing which service produced it.
 */

import type { ProviderId } from "./types.ts";

export type ProviderErrorKind =
  /** Access token expired but a refresh token is present. Refresh and retry. */
  | "auth_expired"
  /** User revoked access, or BYO credentials are wrong. Needs re-onboarding. */
  | "auth_revoked"
  /** Short-term throttle. Retry after `retryAfterMs`. */
  | "rate_limited"
  /** Hard budget spent (Spotify QUOTA_EXCEEDED, YouTube daily units). Stop until reset. */
  | "quota_exceeded"
  /** Item is gone or region-locked. Skip it; do not fail the whole run. */
  | "not_found"
  /** 5xx or network blip. Retry with backoff. */
  | "transient"
  /** Anything unclassified — treated as fatal for the run so it surfaces loudly. */
  | "unknown";

export class ProviderError extends Error {
  readonly provider: ProviderId;
  readonly kind: ProviderErrorKind;
  readonly status: number | undefined;
  /** For `quota_exceeded`: when the budget refills, if known. */
  readonly resetAt: Date | undefined;

  constructor(
    provider: ProviderId,
    kind: ProviderErrorKind,
    message: string,
    options: {
      status?: number;
      resetAt?: Date;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ProviderError";
    this.provider = provider;
    this.kind = kind;
    this.status = options.status;
    this.resetAt = options.resetAt;
  }

  /** Whether an ingest job should retry rather than abandon the run. */
  get retryable(): boolean {
    return this.kind === "rate_limited" || this.kind === "transient" || this.kind === "auth_expired";
  }
}
