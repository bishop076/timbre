import { DEFAULT_POLICIES, ProviderError, type ProviderErrorKind } from "@timbre/core";

import type { SearchContext, SourceId } from "./types.ts";

const DEADLINE_MS = 6_000;

export interface RequesterOptions {
  id: SourceId;
  label: string;
  init: (ctx: SearchContext) => RequestInit;
  classify?: (status: number) => ProviderErrorKind;
  softStatuses?: readonly number[];
  checkBody?: (body: unknown) => void;
  deadlineMs?: number;
}

export function deadlineSignal(caller: AbortSignal | undefined, ms: number = DEADLINE_MS): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return caller ? AbortSignal.any([caller, timeout]) : timeout;
}

export type Requester = <T>(ctx: SearchContext, target: string | URL, init?: RequestInit) => Promise<T>;
export type SoftRequester = <T>(ctx: SearchContext, target: string | URL, init?: RequestInit) => Promise<T | null>;

export function createRequester(options: RequesterOptions & { softStatuses: readonly number[] }): SoftRequester;
export function createRequester(options: RequesterOptions): Requester;
export function createRequester({
  id,
  label,
  init,
  classify,
  softStatuses,
  checkBody,
  deadlineMs = DEADLINE_MS,
}: RequesterOptions): SoftRequester {
  return async <T>(ctx: SearchContext, target: string | URL, extra?: RequestInit): Promise<T | null> => {
    ctx.signal?.throwIfAborted();
    await ctx.limiter.acquire(id, DEFAULT_POLICIES[id]);

    let response: Response;
    try {
      response = await fetch(target, { signal: deadlineSignal(ctx.signal, deadlineMs), ...init(ctx), ...extra });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
      const timedOut = cause instanceof DOMException && cause.name === "TimeoutError";
      const message = timedOut ? `${label} did not answer within ${deadlineMs / 1000}s.` : `${label} unreachable.`;
      throw new ProviderError(id, "transient", message, { cause });
    }

    if (softStatuses?.includes(response.status)) return null;
    if (!response.ok) {
      throw new ProviderError(id, classify?.(response.status) ?? "transient", `${label} returned ${response.status}.`, {
        status: response.status,
      });
    }

    let body: T;
    try {
      body = (await response.json()) as T;
    } catch (cause) {
      throw new ProviderError(id, "transient", `${label} returned an unreadable body.`, { cause });
    }
    checkBody?.(body);
    return body;
  };
}
