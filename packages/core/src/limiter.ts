import type { ProviderId } from "./types.ts";

export interface BucketPolicy {
  capacity: number;
  refillPerSecond: number;
}

export interface BucketState {
  tokens: number;
  updatedAtMs: number;
}

export interface Reservation {
  state: BucketState;
  waitMs: number;
}

export function refill(state: BucketState, policy: BucketPolicy, nowMs: number): BucketState {
  const gained = (Math.max(0, nowMs - state.updatedAtMs) / 1000) * policy.refillPerSecond;
  return { tokens: Math.min(policy.capacity, state.tokens + gained), updatedAtMs: nowMs };
}

export function reserve(
  state: BucketState,
  policy: BucketPolicy,
  cost: number,
  nowMs: number,
): Reservation {
  if (cost > policy.capacity) {
    throw new RangeError(
      `Request costs ${cost} but bucket capacity is ${policy.capacity}; it could never succeed.`,
    );
  }
  const tokens = refill(state, policy, nowMs).tokens - cost;
  const waitMs = tokens >= 0 ? 0 : Math.ceil((-tokens / policy.refillPerSecond) * 1000);
  return { state: { tokens, updatedAtMs: nowMs }, waitMs };
}

export const DEFAULT_POLICIES: Record<ProviderId, BucketPolicy> = {
  ytmusic: { capacity: 10, refillPerSecond: 2 },
  soundcloud: { capacity: 30, refillPerSecond: 5 },
  audius: { capacity: 20, refillPerSecond: 5 },
  archive: { capacity: 8, refillPerSecond: 1 },
  mixcloud: { capacity: 20, refillPerSecond: 5 },
  spotify: { capacity: 40, refillPerSecond: 8 },
  deezer: { capacity: 20, refillPerSecond: 8 },
  apple: { capacity: 5, refillPerSecond: 0.3 },
};

export interface BucketStore {
  load(key: string): Promise<BucketState | null>;
  save(key: string, state: BucketState): Promise<void>;
}

export class MemoryBucketStore implements BucketStore {
  #buckets = new Map<string, BucketState>();

  async load(key: string): Promise<BucketState | null> {
    return this.#buckets.get(key) ?? null;
  }

  async save(key: string, state: BucketState): Promise<void> {
    this.#buckets.set(key, state);
  }
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const settle = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", settle);
      if (signal?.aborted) reject(signal.reason);
      else resolve();
    };
    const timer = setTimeout(settle, ms);
    signal?.addEventListener("abort", settle);
    if (signal?.aborted) settle();
  });
}

export interface AcquireOptions {
  cost?: number;
  maxWaitMs?: number;
  signal?: AbortSignal;
}

export class RateLimiter {
  readonly #store: BucketStore;
  readonly #now: () => number;
  readonly #queues = new Map<string, Promise<void>>();

  constructor(store: BucketStore, now: () => number = Date.now) {
    this.#store = store;
    this.#now = now;
  }

  async acquire(
    key: string,
    policy: BucketPolicy,
    { cost = 1, maxWaitMs = Infinity, signal }: AcquireOptions = {},
  ): Promise<boolean> {
    const waitMs = await this.#inTurn(key, () => this.#reserve(key, policy, cost, maxWaitMs, signal));
    if (waitMs === null) return false;
    if (waitMs === 0) return true;
    try {
      await sleep(waitMs, signal);
      return true;
    } catch (cause) {
      await this.#inTurn(key, () => this.#refund(key, policy, cost));
      throw cause;
    }
  }

  async #reserve(
    key: string,
    policy: BucketPolicy,
    cost: number,
    maxWaitMs: number,
    signal: AbortSignal | undefined,
  ): Promise<number | null> {
    signal?.throwIfAborted();
    const now = this.#now();
    const stored = await this.#store.load(key);
    const { state, waitMs } = reserve(stored ?? { tokens: policy.capacity, updatedAtMs: now }, policy, cost, now);
    if (waitMs > maxWaitMs) return null;
    await this.#store.save(key, state);
    return waitMs;
  }

  async #refund(key: string, policy: BucketPolicy, cost: number): Promise<void> {
    const now = this.#now();
    const stored = await this.#store.load(key);
    if (!stored) return;
    const tokens = Math.min(policy.capacity, refill(stored, policy, now).tokens + cost);
    await this.#store.save(key, { tokens, updatedAtMs: now });
  }

  #inTurn<T>(key: string, step: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(key) ?? Promise.resolve();
    const turn = previous.then(step);
    const link = turn.then(
      () => {},
      () => {},
    );
    this.#queues.set(key, link);
    void link.then(() => {
      if (this.#queues.get(key) === link) this.#queues.delete(key);
    });
    return turn;
  }
}
