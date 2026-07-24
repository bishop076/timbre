import { getDatabase } from "@timbre/db";
import { sql } from "drizzle-orm";

import { getEnv, hasEmailAuth, hasSoundCloud } from "@/lib/env";

/**
 * Aggregate liveness check for both deployables.
 *
 * Reports which optional integrations are configured, so a half-set-up
 * environment is visible immediately rather than surfacing later as a confusing
 * failure mid-OAuth. It never reports secret values, only whether they exist.
 */
export const dynamic = "force-dynamic";

type Check = { status: "ok" | "error"; detail?: string };

async function checkDatabase(): Promise<Check> {
  try {
    await getDatabase().execute(sql`select 1`);
    return { status: "ok" };
  } catch (error) {
    return { status: "error", detail: error instanceof Error ? error.message : String(error) };
  }
}

async function checkYtMusic(url: string): Promise<Check> {
  try {
    const response = await fetch(new URL("/health", url), {
      signal: AbortSignal.timeout(2_000),
      cache: "no-store",
    });
    return response.ok
      ? { status: "ok" }
      : { status: "error", detail: `sidecar returned ${response.status}` };
  } catch (error) {
    return {
      status: "error",
      detail: error instanceof Error ? error.message : "sidecar unreachable",
    };
  }
}

export async function GET() {
  const env = getEnv();
  const [database, ytmusic] = await Promise.all([
    checkDatabase(),
    checkYtMusic(env.YTMUSIC_SERVICE_URL),
  ]);

  const healthy = database.status === "ok" && ytmusic.status === "ok";

  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      services: { database, ytmusic },
      configured: {
        emailAuth: hasEmailAuth(env),
        soundcloud: hasSoundCloud(env),
      },
    },
    { status: healthy ? 200 : 503 },
  );
}
