import "server-only";

// pg-boss 12 exports the class as a named export; there is no default export.
import { PgBoss } from "pg-boss";

import { getEnv } from "./env";

/**
 * Durable job queue for library ingest.
 *
 * Postgres-backed rather than Redis so there is one piece of infrastructure to
 * run and back up. Ingest has to be a background job rather than a request
 * handler: Spotify removed batch endpoints in Feb 2026, so reading a
 * 2,000-track library is roughly 2,000 paced requests — far past any HTTP
 * timeout.
 */

export const QUEUES = {
  /** Pull liked songs for one connection. */
  syncLiked: "sync.liked",
  /** Pull the playlist list for one connection. */
  syncPlaylists: "sync.playlists",
  /** Pull the tracks of one playlist. Fanned out by `sync.playlists`. */
  syncPlaylistTracks: "sync.playlist-tracks",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface SyncJob {
  connectionId: string;
  /** Set for `sync.playlist-tracks`. */
  playlistId?: string;
  /** Resume point from a previous interrupted run. */
  cursor?: string;
}

const globalForBoss = globalThis as unknown as { __timbreBoss?: Promise<PgBoss> };

/**
 * Starts (or returns) the shared pg-boss instance. Cached on globalThis for the
 * same reason as the database pool: Next's dev hot-reload would otherwise start
 * a new boss on every edit, each with its own maintenance timers.
 */
export function getQueue(): Promise<PgBoss> {
  if (globalForBoss.__timbreBoss) return globalForBoss.__timbreBoss;

  const started = (async () => {
    const boss = new PgBoss({
      connectionString: getEnv().DATABASE_URL,
      // Keep pg-boss's bookkeeping out of the application schema.
      schema: "pgboss",
    });
    boss.on("error", (error: unknown) => {
      console.error("[pg-boss]", error);
    });
    await boss.start();
    for (const queue of Object.values(QUEUES)) {
      await boss.createQueue(queue);
    }
    return boss;
  })();

  globalForBoss.__timbreBoss = started;
  return started;
}

export async function enqueueSync(queue: QueueName, job: SyncJob): Promise<void> {
  const boss = await getQueue();
  await boss.send(queue, job, {
    // One in-flight job per connection per queue. Two concurrent syncs of the
    // same library would double-spend a quota that is already the binding
    // constraint.
    singletonKey: `${queue}:${job.connectionId}${job.playlistId ? `:${job.playlistId}` : ""}`,
    retryLimit: 5,
    retryBackoff: true,
  });
}
