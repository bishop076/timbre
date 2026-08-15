import { mergeTracks, searchAll } from "@timbre/providers";
import { z } from "zod";

import { cached, guard } from "@/lib/api";
import { getProviderRuntime } from "@/lib/providers";

/** Cross-source search. Public and unauthenticated by design — Timbre is meant to be
 * usable from a link, without an account. */
export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function GET(request: Request) {
  const refusal = guard(request);
  if (refusal) return refusal;

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

  /* Cached across everyone, not per client: every search fans out to three services and
   * Apple allows ~20 requests a minute for the whole deployment. Results are public
   * catalogue data, so there is nothing personal to leak. Case and space are folded in. */
  const key = `search:${parsed.data.limit}:${parsed.data.q.trim().toLowerCase()}`;

  const body = await cached(key, async () => {
    const { limiter } = getProviderRuntime();
    const { tracks, failures, attempted } = await searchAll(
      // Deliberately not `request.signal`: a cached call is shared, so aborting it because
      // one subscriber navigated away would cancel the answer everyone else waits on.
      { limiter },
      parsed.data.q,
      parsed.data.limit,
    );

    // Failures travel alongside results rather than thrown — one source being down is
    // normal — and `attempted` lets the client tell an outage from a search that matched nothing.
    return { songs: mergeTracks(tracks), failures, attempted };
  });

  return Response.json(body);
}
