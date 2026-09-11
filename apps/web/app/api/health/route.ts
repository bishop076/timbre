import { guard } from "@/lib/api";
import { getEnv, hasSoundCloud } from "@/lib/env";

export const dynamic = "force-dynamic";

async function checkYtMusic(url: string): Promise<{ status: "ok" | "error"; detail?: string }> {
  try {
    const response = await fetch(new URL("/health", url), {
      signal: AbortSignal.timeout(2_000),
      cache: "no-store",
    });
    if (response.ok) return { status: "ok" };
    return { status: "error", detail: `sidecar returned ${response.status}` };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "sidecar unreachable";
    return { status: "error", detail };
  }
}

export async function GET(request: Request) {
  const refusal = guard(request, "health");
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
