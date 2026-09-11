import { guardHealth } from "@/lib/api";
import { getEnv, hasSoundCloud } from "@/lib/env";

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

export async function GET(request: Request) {
  const refusal = guardHealth(request);
  if (refusal) return refusal;

  const env = getEnv();
  const ytmusic = await checkYtMusic(env.YTMUSIC_SERVICE_URL);
  const healthy = ytmusic.status === "ok";

  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      services: { ytmusic },
      configured: { soundcloud: hasSoundCloud(env) },
    },
    { status: healthy ? 200 : 503 },
  );
}
