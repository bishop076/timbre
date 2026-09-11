import type { ProviderId } from "./types.ts";

export type ProviderErrorKind = "auth_expired" | "rate_limited" | "transient" | "unknown";

export class ProviderError extends Error {
  readonly provider: ProviderId;
  readonly kind: ProviderErrorKind;
  readonly status: number | undefined;

  constructor(
    provider: ProviderId,
    kind: ProviderErrorKind,
    message: string,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ProviderError";
    this.provider = provider;
    this.kind = kind;
    this.status = options.status;
  }
}
