import { chartAll, mergeTracks } from "@timbre/providers";

import { getProviderRuntime } from "@/lib/providers";
import { CACHE_CONTROL_HOUR, reportFailures } from "@/lib/api";

export const revalidate = 3600;

export const dynamic = "force-static";

export async function GET() {
  const { limiter } = getProviderRuntime();
  const { tracks, failures, attempted } = await chartAll({ limiter }, 24);
  reportFailures("/api/charts", failures);

  return Response.json(
    { songs: mergeTracks(tracks), failures, attempted },
    { headers: { "cache-control": CACHE_CONTROL_HOUR } },
  );
}
