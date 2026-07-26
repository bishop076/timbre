import { chartAll, mergeTracks } from "@timbre/providers";

import { getProviderRuntime } from "@/lib/providers";

/**
 * What's popular right now, for the home page.
 *
 * Cached for an hour: charts move slowly, and Apple's iTunes API allows only
 * about 20 requests per minute per IP, so hitting it once per visitor would
 * exhaust the budget almost immediately.
 */
export const revalidate = 3600;

export async function GET(request: Request) {
  const { limiter } = getProviderRuntime();
  const { tracks, failures } = await chartAll({ limiter, signal: request.signal }, 24);

  return Response.json(
    { songs: mergeTracks(tracks), failures },
    {
      headers: {
        "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}
