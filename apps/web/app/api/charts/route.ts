import { chartAll, mergeTracks } from "@timbre/providers";

import { CACHE_CONTROL_HOUR, json, reportFailures } from "@/lib/api";
import { getProviderRuntime } from "@/lib/providers";

export const revalidate = 3600;

export const dynamic = "force-static";

export async function GET() {
  const { tracks, failures, attempted } = await chartAll(getProviderRuntime(), 24);
  reportFailures("/api/charts", failures);
  return json({ songs: mergeTracks(tracks), failures, attempted }, CACHE_CONTROL_HOUR);
}
