/*
 * One request path for every adapter: pace, fetch, judge the status, hand back the body. Each
 * source's differences stay parameters — `init`, `classify`, `softStatuses`, `checkBody` — because
 * those differences are where every real trap in these adapters lives.
 */

import { DEFAULT_POLICIES, ProviderError, type ProviderErrorKind } from "@timbre/core";

import type { SearchContext, SourceId } from "./types.ts";

/**
 * How long any one upstream call may take before it is abandoned.
 *
 * **`fetch` has no timeout of its own, and nothing above this supplied one.** `searchAll`
 * fans out under `Promise.allSettled`, and `/api/search` deliberately passes no signal —
 * a cached call is shared, so one subscriber navigating away must not cancel the answer
 * everyone else is waiting on. Both of those are right, and together they meant a source
 * that accepted the connection and then said nothing stalled the whole search until the
 * platform's own limit — 300s on Vercel — with `cached()`'s in-flight entry holding every
 * concurrent search for that query alongside it.
 *
 * `soundcloud-client-id.ts` already learned this the hard way and fixed it locally; this is
 * the same lesson applied where every adapter actually goes out. Six seconds matches what
 * `lib/deezer.ts` and `/api/lyrics` had already chosen independently.
 *
 * A source that is merely slow is dropped from *this* search and reported as a failure,
 * which the UI already renders — that is strictly better than the search never returning.
 */
const DEADLINE_MS = 6_000;

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
  /** Overridable per source, for one that is legitimately slower. Defaults to {@link DEADLINE_MS}. */
  deadlineMs?: number;
}

/**
 * The caller's signal and this request's deadline, as one signal.
 *
 * Composed rather than chosen: honouring only the deadline would ignore a caller that did
 * abort, and honouring only the caller would leave the hang this exists to stop. Kept out
 * of the closure so each call gets its own timer — `AbortSignal.timeout` starts counting
 * when it is created, so a module-level one would expire six seconds after startup.
 */
function deadlineSignal(caller: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return caller ? AbortSignal.any([caller, timeout]) : timeout;
}

export type Requester = <T>(ctx: SearchContext, target: string | URL, init?: RequestInit) => Promise<T>;

/** What `softStatuses` buys: those statuses come back as null instead of throwing. */
export type SoftRequester = <T>(ctx: SearchContext, target: string | URL, init?: RequestInit) => Promise<T | null>;

export function createRequester(options: RequesterOptions & { softStatuses: readonly number[] }): SoftRequester;
export function createRequester(options: RequesterOptions): Requester;
export function createRequester(options: RequesterOptions): SoftRequester {
  const { id, label, init, classify, softStatuses, checkBody, deadlineMs = DEADLINE_MS } = options;

  return async <T>(ctx: SearchContext, target: string | URL, extra?: RequestInit): Promise<T | null> => {
    await ctx.limiter.acquire(id, DEFAULT_POLICIES[id]);

    // Composed here rather than in the object literal so `init`/`extra` can still override
    // it outright, which is the existing contract — the spread order below is unchanged.
    const signal = deadlineSignal(ctx.signal, deadlineMs);

    let response: Response;
    try {
      response = await fetch(target, { signal, ...init(ctx), ...extra });
    } catch (cause) {
      // A timeout and a refused connection are both `transient`, and both retried the same
      // way — but they are not the same operational problem, and a log that cannot tell
      // "the host is gone" from "the host is answering too slowly" sends you to the wrong
      // place. `TimeoutError` is what `AbortSignal.timeout` raises; a caller's own abort
      // raises `AbortError` and is not this.
      const timedOut = cause instanceof DOMException && cause.name === "TimeoutError";
      throw new ProviderError(
        id,
        "transient",
        timedOut ? `${label} did not answer within ${deadlineMs / 1000}s.` : `${label} unreachable.`,
        { cause },
      );
    }

    if (softStatuses?.includes(response.status)) return null;

    if (!response.ok) {
      throw new ProviderError(id, classify?.(response.status) ?? "transient", `${label} returned ${response.status}.`, {
        status: response.status,
      });
    }

    // Reading the body is a second place the connection can fail, and it was the one place
    // a failure escaped as something other than a `ProviderError`: a source answering 200
    // with an HTML error page threw a bare `SyntaxError` past every caller that catches
    // this source's own errors. The deadline covers the body too — `signal` aborts the
    // stream, not just the headers — so a response that stalls mid-body lands here.
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
