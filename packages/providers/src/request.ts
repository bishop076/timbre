import { DEFAULT_POLICIES, ProviderError, type BucketPolicy, type ProviderErrorKind } from "@timbre/core";

import type { SearchContext, SourceId } from "./types.ts";

const DEADLINE_MS = 6_000;

/**
 * How much of an answer any source is allowed to be.
 *
 * A deadline bounds how long a source may take; nothing bounded how much it could send, so a
 * host that kept writing filled the heap instead of the clock. Measured against the live
 * services on 2026-09-15: the largest JSON any provider returns is 615 KB (Audius, 100 tracks),
 * and the largest page read is 162 KB (`open.spotify.com/search`). Four megabytes leaves every
 * one of those six times over.
 *
 * Vendor *scripts* are the exception and carry their own bound below: Spotify's web-player
 * bundle measured 4.3 MB and SoundCloud's largest asset bundle 2.9 MB, so lifting the shared
 * limit to fit them would have given every JSON endpoint the same room for no reason.
 */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** The bound for the two hash/client-id crawls, which really do read vendor bundles. */
export const MAX_SCRIPT_BYTES = 8 * 1024 * 1024;

export interface RequesterOptions {
  id: SourceId;
  label: string;
  init: (ctx: SearchContext) => RequestInit;
  classify?: (status: number) => ProviderErrorKind;
  softStatuses?: readonly number[];
  checkBody?: (body: unknown) => void;
  deadlineMs?: number;
  maxBytes?: number;
}

export function deadlineSignal(caller: AbortSignal | undefined, ms: number = DEADLINE_MS): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return caller ? AbortSignal.any([caller, timeout]) : timeout;
}

/**
 * `fetch`, with the failure typed and named rather than left as a `DOMException`.
 *
 * Third occurrence: the requester below, Spotify's page fetches and Spotify's oEmbed/MusicBrainz
 * lookups all need the same three-way split — the caller's own abort passes through untouched, a
 * deadline is reported as a deadline, and anything else is the host being unreachable. The two
 * Spotify paths did not go through the requester and so had none of it, and threw the raw
 * `TimeoutError` at callers that only catch `ProviderError`.
 */
export async function fetchOrFail(
  target: string | URL,
  init: RequestInit,
  id: SourceId,
  label: string,
  ms: number = DEADLINE_MS,
): Promise<Response> {
  try {
    return await fetch(target, init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    const timedOut = cause instanceof DOMException && cause.name === "TimeoutError";
    const message = timedOut ? `${label} did not answer within ${ms / 1000}s.` : `${label} unreachable.`;
    throw new ProviderError(id, "transient", message, { cause });
  }
}

/**
 * The body as text, or this source's error if there is more of it than we agreed to read.
 *
 * Counting after the fact would mean the bytes were already here, so this reads the stream and
 * stops at the first chunk that crosses the line — the connection is cancelled, nothing further
 * is decoded, and the caller is told plainly. Truncating instead would be worse than either: a
 * half-read body fails a `JSON.parse` or a regex and reports itself as "the source sent
 * nonsense", which sends whoever reads the log to the wrong service.
 */
const asSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${Math.round(bytes / 1024 / 1024)} MB` : `${Math.round(bytes / 1024)} KB`;

export async function readCapped(
  response: Response,
  id: SourceId,
  label: string,
  maxBytes = MAX_BODY_BYTES,
): Promise<string> {
  const stream = response.body;
  if (!stream) return "";

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let read = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      read += value.byteLength;
      if (read > maxBytes) {
        await reader.cancel();
        throw new ProviderError(id, "transient", `${label} sent more than ${asSize(maxBytes)}; the read was stopped.`);
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  return text + decoder.decode();
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
  maxBytes = MAX_BODY_BYTES,
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

    const response = await fetchOrFail(target, { signal, ...init(ctx), ...extra }, id, label, deadlineMs);

    if (softStatuses?.includes(response.status)) return null;
    if (!response.ok) {
      throw new ProviderError(id, classify?.(response.status) ?? "transient", `${label} returned ${response.status}.`, {
        status: response.status,
      });
    }

    let body: T;
    try {
      body = JSON.parse(await readCapped(response, id, label, maxBytes)) as T;
    } catch (cause) {
      // An oversized body has already said what went wrong, in this source's name. Wrapping it
      // as "an unreadable body" would blame the shape of the answer for its size.
      if (cause instanceof ProviderError) throw cause;
      throw new ProviderError(id, "transient", `${label} returned an unreadable body.`, { cause });
    }
    checkBody?.(body);
    return body;
  };
}
