import { mergeTracks, searchAll } from "@timbre/providers";
import { z } from "zod";

import { getProviderRuntime } from "@/lib/providers";

/**
 * Cross-source search.
 *
 * Public and unauthenticated by design — Timbre is meant to be usable from a
 * link, without an account.
 */
export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    q: url.searchParams.get("q"),
    limit: url.searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    return Response.json(
      { error: "A search query is required.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { limiter } = getProviderRuntime();
  const { tracks, failures } = await searchAll(
    { limiter, signal: request.signal },
    parsed.data.q,
    parsed.data.limit,
  );

  // Failures are reported alongside results rather than thrown: one source
  // being down is normal, and Timbre's whole premise is that there is more
  // than one.
  return Response.json({
    songs: mergeTracks(tracks),
    failures,
  });
}
