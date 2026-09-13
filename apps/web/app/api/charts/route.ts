import { chartAll, mergeTracks } from "@timbre/providers";

import { cached, CACHE_CONTROL_HOUR, json, publicFailures, reportFailures, whole } from "@/lib/api";
import { getProviderRuntime } from "@/lib/providers";

export const dynamic = "force-dynamic";

// `force-static` with `revalidate = 3600` froze whatever this happened to return at the
// revalidation moment — so an Apple 403 or a Deezer blip baked a half-empty home page in for
// an hour, with a day of stale-while-revalidate behind it, and nothing retried until the
// window expired. `chartAll` allSettles, so a degraded run is a 200 like any other. This is
// the same shape `/api/search` and `/api/radio` now use: serve the caller the best that could
// be had, do not remember it, and do not let the CDN remember it either.
export async function GET() {
  const body = await cached(
    "charts:24",
    async () => {
      const { tracks, failures, attempted } = await chartAll(getProviderRuntime(), 24);
      reportFailures("/api/charts", failures);
      return { songs: mergeTracks(tracks), failures: publicFailures(failures), attempted };
    },
    whole,
  );
  return json(body, whole(body) ? CACHE_CONTROL_HOUR : "no-store");
}
