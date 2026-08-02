import { getEnv, hasSoundCloud } from "@/lib/env";

/**
 * Liveness check.
 *
 * There is exactly one dependency left to report on. Timbre stores nothing
 * about anyone — playlists, profile and history all live in the reader's
 * browser — so there is no database to be up or down, and the only way this
 * endpoint can be unhealthy is the YouTube Music sidecar being unreachable.
 */
export const dynamic = "force-dynamic";

type Check = { status: "ok" | "error"; detail?: string };

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
  const ytmusic = await checkYtMusic(env.YTMUSIC_SERVICE_URL);
  const healthy = ytmusic.status === "ok";

  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      services: { ytmusic },
      // Never secret values, only whether they exist, so a half-configured
      // environment is visible immediately rather than failing confusingly.
      configured: { soundcloud: hasSoundCloud(env) },
    },
    { status: healthy ? 200 : 503 },
  );
}
