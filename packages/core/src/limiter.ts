/**
 * Rate and quota accounting.
 *
 * This is a first-class component rather than a retry helper, because
 * Spotify's Feb 2026 changes removed batch endpoints: reading a 2,000-track
 * library is now ~2,000 individual requests. Ingest lives or dies on pacing.
 *
 * Two distinct budgets are modelled, and conflating them is the classic bug:
 *
 *   rate  — requests per unit time. Recoverable in seconds. Wait and continue.
 *   quota — a hard allowance (Spotify's per-developer-account pool, YouTube's
 *           10,000 units/day). Recoverable only at reset. Retrying is useless
 *           and burns the next day's budget.
 *
 * The bucket maths is pure so it can be unit-tested without a clock or a
 * database; persistence is injected via {@link BucketStore}.
 */

import { ProviderError } from "./errors.ts";
import type { ProviderId } from "./types.ts";

export interface BucketPolicy {
  /** Maximum burst. */
  capacity: number;
  /** Steady-state replenishment. */
  refillPerSecond: number;
}

export interface BucketState {
  tokens: number;
  updatedAtMs: number;
}

export type ConsumeResult =
  | { ok: true; state: BucketState }
  | { ok: false; state: BucketState; waitMs: number };

/** Advances a bucket to `nowMs`. Pure; clamps at capacity. */
export function refill(state: BucketState, policy: BucketPolicy, nowMs: number): BucketState {
  const elapsedMs = Math.max(0, nowMs - state.updatedAtMs);
  const gained = (elapsedMs / 1000) * policy.refillPerSecond;
  return {
    tokens: Math.min(policy.capacity, state.tokens + gained),
    updatedAtMs: nowMs,
  };
}

/**
 * Attempts to spend `cost` tokens. On failure returns how long to wait for the
 * bucket to hold enough — callers should sleep exactly that long rather than
 * poll, which is what turns a throttle into a thundering herd.
 */
export function tryConsume(
  state: BucketState,
  policy: BucketPolicy,
  cost: number,
  nowMs: number,
): ConsumeResult {
  if (cost > policy.capacity) {
    throw new RangeError(
      `Request costs ${cost} but bucket capacity is ${policy.capacity}; it could never succeed.`,
    );
  }

  const filled = refill(state, policy, nowMs);
  if (filled.tokens >= cost) {
    return { ok: true, state: { tokens: filled.tokens - cost, updatedAtMs: nowMs } };
  }

  const deficit = cost - filled.tokens;
  return {
    ok: false,
    state: filled,
    waitMs: Math.ceil((deficit / policy.refillPerSecond) * 1000),
  };
}

/**
 * Default pacing per provider. Deliberately conservative: none of these
 * services publish exact limits, and being throttled costs far more wall-clock
 * than running slightly under the ceiling.
 */
export const DEFAULT_POLICIES: Record<ProviderId, BucketPolicy> = {
  // Unofficial endpoints. Slow and steady; the source most likely to notice
  // and least likely to tell us why.
  ytmusic: { capacity: 10, refillPerSecond: 2 },
  soundcloud: { capacity: 30, refillPerSecond: 5 },
  // Spotify's published limit is a rolling 30s window and is not a documented
  // constant. ~8 req/s with room for a short burst has headroom under it.
  spotify: { capacity: 40, refillPerSecond: 8 },
  // Deezer's public catalogue is generous — roughly 50 requests per 5 seconds.
  deezer: { capacity: 20, refillPerSecond: 8 },
  // Apple's iTunes Search API is the tightest of the lot: about 20 requests
  // per minute per IP, and it answers with 403 rather than 429 when exceeded.
  apple: { capacity: 5, refillPerSecond: 0.3 },
};

/**
 * YouTube Data API v3 unit costs. The default allowance is 10,000 units/day,
 * so a naive playlist transfer exhausts the budget after ~200 tracks.
 * @see https://developers.google.com/youtube/v3/determine_quota_cost
 */
export const YOUTUBE_UNIT_COSTS = {
  read: 1,
  write: 50,
  search: 100,
  upload: 1600,
} as const;

export const YOUTUBE_DAILY_UNITS = 10_000;

export type LimitOutcome =
  | { kind: "rate"; retryAfterMs: number }
  | { kind: "quota"; resetAt: Date | undefined }
  | { kind: "none" };

/**
 * Classifies a 429. Spotify's July 2026 update added a `reason` field
 * specifically so callers can tell a throttle from an exhausted quota; without
 * checking it, a client hot-retries all day against a budget that will not
 * refill until midnight.
 */
export function classify429(
  status: number,
  headers: Headers,
  body: unknown,
  nowMs: number = Date.now(),
): LimitOutcome {
  if (status !== 429) return { kind: "none" };

  const reason =
    typeof body === "object" && body !== null
      ? (body as { error?: { reason?: unknown } }).error?.reason
      : undefined;

  if (reason === "QUOTA_EXCEEDED") {
    return { kind: "quota", resetAt: undefined };
  }

  const retryAfter = headers.get("retry-after");
  // Retry-After is either delta-seconds or an HTTP date.
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      return { kind: "rate", retryAfterMs: Math.max(0, seconds * 1000) };
    }
    const asDate = Date.parse(retryAfter);
    if (!Number.isNaN(asDate)) {
      return { kind: "rate", retryAfterMs: Math.max(0, asDate - nowMs) };
    }
  }

  // 429 with no usable hint. Back off a sane default rather than hammering.
  return { kind: "rate", retryAfterMs: 5_000 };
}

/** Persistence for buckets, so pacing survives restarts and spans processes. */
export interface BucketStore {
  load(key: string): Promise<BucketState | null>;
  save(key: string, state: BucketState): Promise<void>;
}

/** In-memory store. For tests and single-process development only. */
export class MemoryBucketStore implements BucketStore {
  #buckets = new Map<string, BucketState>();

  async load(key: string): Promise<BucketState | null> {
    return this.#buckets.get(key) ?? null;
  }

  async save(key: string, state: BucketState): Promise<void> {
    this.#buckets.set(key, state);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Paces calls for one connection. `key` is per-connection rather than per
 * provider, since with BYO credentials each user spends their own quota.
 */
export class RateLimiter {
  readonly #store: BucketStore;
  readonly #now: () => number;

  constructor(store: BucketStore, now: () => number = Date.now) {
    this.#store = store;
    this.#now = now;
  }

  /** Blocks until `cost` tokens are available, then spends them. */
  async acquire(key: string, policy: BucketPolicy, cost = 1): Promise<void> {
    // Loop rather than sleep-once: another process sharing this key may consume
    // the tokens we were waiting for.
    for (;;) {
      const stored = await this.#store.load(key);
      const state = stored ?? { tokens: policy.capacity, updatedAtMs: this.#now() };
      const result = tryConsume(state, policy, cost, this.#now());

      if (result.ok) {
        await this.#store.save(key, result.state);
        return;
      }

      await this.#store.save(key, result.state);
      await sleep(result.waitMs);
    }
  }

  /**
   * Applies a provider's own 429 to local state: drains the bucket so the next
   * `acquire` waits, and converts an exhausted quota into a non-retryable error.
   */
  async penalize(
    key: string,
    provider: ProviderId,
    outcome: LimitOutcome,
  ): Promise<void> {
    if (outcome.kind === "quota") {
      throw new ProviderError(provider, "quota_exceeded", `${provider} quota exhausted.`, {
        status: 429,
        resetAt: outcome.resetAt,
      });
    }
    if (outcome.kind === "rate") {
      await this.#store.save(key, {
        tokens: 0,
        updatedAtMs: this.#now() + outcome.retryAfterMs,
      });
    }
  }
}
