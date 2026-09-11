import { chartAll, mergeTracks } from "@timbre/providers";

import { getProviderRuntime } from "@/lib/providers";
import { CACHE_CONTROL_HOUR, reportFailures } from "@/lib/api";

/**
 * What's popular right now, for the home page.
 *
 * Cached for an hour: charts move slowly, and Apple's iTunes API allows only
 * about 20 requests per minute per IP, so hitting it once per visitor would
 * exhaust the budget almost immediately.
 */
export const revalidate = 3600;

/*
 * `revalidate` alone did nothing here. Route Handlers are **not** cached by default — only
 * `force-static` opts a GET in — so this handler ran on every request, and the sole thing
 * keeping it off Deezer and Apple was the `s-maxage` header below. The CDN keys on the full
 * URL, so `/api/charts?anything` was a miss and a fresh fan-out, for a route that takes no
 * parameters at all. See docs/EXPOSURE.md, E-6.
 *
 * Static is the honest description: the answer does not depend on the request in any way.
 */
export const dynamic = "force-static";

/*
 * Takes no `Request`, and that is the point of `force-static` rather than an oversight.
 *
 * A static route is rendered at build time and again on revalidation — never once per
 * visitor — so there is no caller to meter and no connection to abort. Both were in here
 * and both had to go: `guard(request)` would have keyed every visitor to one bucket, and
 * `request.signal` reads a private field the build-time stub does not have, which failed
 * the build outright rather than quietly.
 */
export async function GET() {
  const { limiter } = getProviderRuntime();
  const { tracks, failures, attempted } = await chartAll({ limiter }, 24);
  // Once per revalidation, not per visitor — this runs an hour apart at most.
  reportFailures("/api/charts", failures);

  return Response.json(
    { songs: mergeTracks(tracks), failures, attempted },
    { headers: { "cache-control": CACHE_CONTROL_HOUR } },
  );
}
