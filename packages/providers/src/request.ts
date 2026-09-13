import { DEFAULT_POLICIES, ProviderError, type BucketPolicy, type ProviderErrorKind } from "@timbre/core";

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

export async function takeSlot(
  ctx: SearchContext,
  id: SourceId,
  label: string,
  { key = id, policy = DEFAULT_POLICIES[id], ms = DEADLINE_MS }: { key?: string; policy?: BucketPolicy; ms?: number } = {},
): Promise<void> {
  const admitted = await ctx.limiter.acquire(key, policy, { maxWaitMs: ms, signal: ctx.signal });
  if (admitted === false) {
    throw new ProviderError(id, "rate_limited", `${label} has no free request slot within ${ms / 1000}s.`);
  }
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

    // The deadline clock used to start here, before `takeSlot`, and the limiter was handed the
    // whole budget as its own maximum wait. So a 5.9s queue out of a 6s budget was admitted —
    // spending the bucket's token — and the fetch that followed got a signal that aborted
    // almost at once, reported as "<label> did not answer within 6s" for a request that never
    // went out. Under Apple's 0.3/s refill that is the steady state under any load, so the
    // logs and `/api/search`'s `failures[]` accused a healthy provider of timing out.
    //
    // The budget is still shared, which `request.test.ts` asserts on purpose. What changes is
    // that the split is explicit: the queue may have half, the fetch keeps the rest, and
    // running out of time in the queue is reported as the rate limiting it actually is.
    const startedAt = Date.now();
    await takeSlot(ctx, id, label, { ms: Math.max(1, Math.round(deadlineMs / 2)) });

    const left = deadlineMs - (Date.now() - startedAt);
    if (left <= 0) {
      throw new ProviderError(
        id,
        "rate_limited",
        `${label}'s queue used the whole ${deadlineMs / 1000}s before the request could be sent.`,
      );
    }
    const signal = deadlineSignal(ctx.signal, left);

    let response: Response;
    try {
      response = await fetch(target, { signal, ...init(ctx), ...extra });
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
