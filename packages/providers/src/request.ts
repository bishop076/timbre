/*
 * One request path for every adapter: pace, fetch, judge the status, hand back the body. Each
 * source's differences stay parameters — `init`, `classify`, `softStatuses`, `checkBody` — because
 * those differences are where every real trap in these adapters lives.
 */

import { DEFAULT_POLICIES, ProviderError, type ProviderErrorKind } from "@timbre/core";

import type { SearchContext, SourceId } from "./types.ts";

export interface RequesterOptions {
  id: SourceId;
  /** How this source is named in error messages, e.g. "YouTube Music sidecar". */
  label: string;
  /** Options shared by every call to this source — cache policy, method, auth headers. */
  init: (ctx: SearchContext) => RequestInit;
  /** Maps a failing status to a kind. Omitted means every failure is `transient`. */
  classify?: (status: number) => ProviderErrorKind;
  /** Statuses meaning "not available here", which resolve to null instead of throwing. */
  softStatuses?: readonly number[];
  /** Inspects a 200 body. Throw from here for a source that reports failure with a 200. */
  checkBody?: (body: unknown) => void;
}

export type Requester = <T>(ctx: SearchContext, target: string | URL, init?: RequestInit) => Promise<T>;

/** What `softStatuses` buys: those statuses come back as null instead of throwing. */
export type SoftRequester = <T>(ctx: SearchContext, target: string | URL, init?: RequestInit) => Promise<T | null>;

export function createRequester(options: RequesterOptions & { softStatuses: readonly number[] }): SoftRequester;
export function createRequester(options: RequesterOptions): Requester;
export function createRequester(options: RequesterOptions): SoftRequester {
  const { id, label, init, classify, softStatuses, checkBody } = options;

  return async <T>(ctx: SearchContext, target: string | URL, extra?: RequestInit): Promise<T | null> => {
    await ctx.limiter.acquire(id, DEFAULT_POLICIES[id]);

    let response: Response;
    try {
      response = await fetch(target, { signal: ctx.signal, ...init(ctx), ...extra });
    } catch (cause) {
      throw new ProviderError(id, "transient", `${label} unreachable.`, { cause });
    }

    if (softStatuses?.includes(response.status)) return null;

    if (!response.ok) {
      throw new ProviderError(id, classify?.(response.status) ?? "transient", `${label} returned ${response.status}.`, {
        status: response.status,
      });
    }

    const body = (await response.json()) as T;
    checkBody?.(body);
    return body;
  };
}
