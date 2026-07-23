/**
 * Postgres-backed {@link BucketStore}, so rate-limit state is shared by the web
 * process and the ingest worker rather than each keeping its own optimistic
 * copy and together blowing through the provider's limit.
 */

import type { BucketState, BucketStore } from "@timbre/core";
import { eq, sql } from "drizzle-orm";

import type { Database } from "./client.ts";
import { rateBuckets } from "./schema.ts";

export class PgBucketStore implements BucketStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async load(key: string): Promise<BucketState | null> {
    const [row] = await this.#db
      .select({ tokens: rateBuckets.tokens, updatedAtMs: rateBuckets.updatedAtMs })
      .from(rateBuckets)
      .where(eq(rateBuckets.key, key))
      .limit(1);

    return row ? { tokens: row.tokens, updatedAtMs: row.updatedAtMs } : null;
  }

  async save(key: string, state: BucketState): Promise<void> {
    await this.#db
      .insert(rateBuckets)
      .values({ key, tokens: state.tokens, updatedAtMs: state.updatedAtMs })
      .onConflictDoUpdate({
        target: rateBuckets.key,
        set: { tokens: state.tokens, updatedAtMs: state.updatedAtMs },
        // Guard against a stale writer rolling the bucket backwards, which
        // would hand out tokens that another process already spent.
        where: sql`${rateBuckets.updatedAtMs} <= ${state.updatedAtMs}`,
      });
  }
}
