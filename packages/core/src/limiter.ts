/*
 * Rate and quota accounting. Two budgets, and conflating them is the classic bug: a *rate*
 * recovers in seconds, so wait and continue, while a *quota* (YouTube's 10,000 units/day)
 * recovers only at reset, so retrying burns the next day's budget.
 */

import type { ProviderId } from "./types.ts";

export interface BucketPolicy {
  capacity: number;
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

/** Spends `cost` tokens, or returns how long to wait. Sleep exactly that long — polling turns a throttle into a herd. */
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

/** Default pacing per provider. Conservative: none publish exact limits, and a throttle costs more than the headroom. */
export const DEFAULT_POLICIES: Record<ProviderId, BucketPolicy> = {
  // Unofficial endpoints — most likely to notice, least likely to say why.
  ytmusic: { capacity: 10, refillPerSecond: 2 },
  soundcloud: { capacity: 30, refillPerSecond: 5 },
  // Audius publishes no limit and did not throttle 12 requests back to back (measured
  // 2026-08-19), which is an absence of evidence rather than a licence. Paced like Deezer.
  audius: { capacity: 20, refillPerSecond: 5 },
  // The Internet Archive asks for restraint rather than publishing a number, and a radio
  // contribution costs two calls (search, then the item's file list). Paced well below
  // anything else here because it is a courtesy read of a nonprofit's index.
  archive: { capacity: 8, refillPerSecond: 1 },
  // Spotify's limit is an undocumented rolling 30s window.
  spotify: { capacity: 40, refillPerSecond: 8 },
  // Deezer's public catalogue allows roughly 50 requests per 5 seconds.
  deezer: { capacity: 20, refillPerSecond: 8 },
  // Apple is tightest: ~20/minute/IP, answered with 403 rather than 429.
  apple: { capacity: 5, refillPerSecond: 0.3 },
};

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

/** Paces calls for one connection — `key` is per-connection, since each user spends their own quota. */
export class RateLimiter {
  readonly #store: BucketStore;
  readonly #now: () => number;

  constructor(store: BucketStore, now: () => number = Date.now) {
    this.#store = store;
    this.#now = now;
  }

  /** Blocks until `cost` tokens are available, then spends them. */
  async acquire(key: string, policy: BucketPolicy, cost = 1): Promise<void> {
    // Loop rather than sleep-once: another process on this key may take the tokens.
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

}
