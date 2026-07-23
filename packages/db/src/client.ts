import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema.ts";

export type Database = ReturnType<typeof createDatabase>;

export function createDatabase(connectionString: string) {
  const pool = new Pool({ connectionString });
  return drizzle(pool, { schema });
}

// Next.js recreates modules on every hot reload in development. Without a
// global cache each reload leaks a connection pool until Postgres refuses new
// clients, which presents as a mystery "too many connections" after ten minutes
// of editing.
const globalForDb = globalThis as unknown as { __timbreDb?: Database };

export function getDatabase(): Database {
  if (globalForDb.__timbreDb) return globalForDb.__timbreDb;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  }

  const db = createDatabase(connectionString);
  if (process.env.NODE_ENV !== "production") globalForDb.__timbreDb = db;
  return db;
}

export { schema };
