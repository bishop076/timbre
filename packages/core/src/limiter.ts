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

export function refill(state: BucketState, policy: BucketPolicy, nowMs: number): BucketState {
  const gained = (Math.max(0, nowMs - state.updatedAtMs) / 1000) * policy.refillPerSecond;
  return { tokens: Math.min(policy.capacity, state.tokens + gained), updatedAtMs: nowMs };
}

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
  const waitMs = Math.ceil(((cost - filled.tokens) / policy.refillPerSecond) * 1000);
  return { ok: false, state: filled, waitMs };
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class RateLimiter {
  readonly #store: BucketStore;
  readonly #now: () => number;
  readonly #queues = new Map<string, Promise<void>>();

  constructor(store: BucketStore, now: () => number = Date.now) {
    this.#store = store;
    this.#now = now;
  }

  acquire(key: string, policy: BucketPolicy, cost = 1): Promise<void> {
    const previous = this.#queues.get(key) ?? Promise.resolve();
    const turn = previous.then(() => this.#acquire(key, policy, cost));
    const link = turn.catch(() => {});
    this.#queues.set(key, link);
    void link.then(() => {
      if (this.#queues.get(key) === link) this.#queues.delete(key);
    });
    return turn;
  }

  async #acquire(key: string, policy: BucketPolicy, cost: number): Promise<void> {
    for (;;) {
      const stored = await this.#store.load(key);
      const state = stored ?? { tokens: policy.capacity, updatedAtMs: this.#now() };
      const result = tryConsume(state, policy, cost, this.#now());
      await this.#store.save(key, result.state);
      if (result.ok) return;
      await sleep(result.waitMs);
    }
  }
}
