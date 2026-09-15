import { guard } from "@/lib/api";
import { getEnv, hasSoundCloud } from "@/lib/env";
import { describeError, log } from "@/lib/log";

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
    // `error.message` here is the platform's own text — "connect ECONNREFUSED 127.0.0.1:8787"
    // and the like — returned verbatim to an unauthenticated caller, while every log path in
    // the app scrubs through `describeError`. Say what happened, not where.
    log("warn", "health_sidecar_unreachable", { ...describeError(error) });
    return { status: "error", detail: "sidecar unreachable" };
  }
}

export async function GET(request: Request) {
  const refusal = guard(request, "health");
  if (refusal) return refusal;

  // `getEnv()` throws on a deployment whose variables do not parse, and an unhandled throw
  // makes this a 500 carrying whatever the platform decides to say — from the one route whose
  // whole job is to answer when the rest of the app cannot. A misconfigured deployment is
  // exactly when somebody curls it. Its message names every variable that failed, which is a
  // thing for the log and not for an unauthenticated caller, so it goes through `describeError`
  // like every other failure here.
  let env: ReturnType<typeof getEnv>;
  try {
    env = getEnv();
  } catch (error) {
    log("error", "health_env_invalid", { ...describeError(error) });
    return Response.json(
      { status: "error", services: {}, configured: {}, detail: "configuration invalid" },
      { status: 503 },
    );
  }

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
