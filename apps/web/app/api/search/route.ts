import { mergeTracks, searchAll } from "@timbre/providers";
import { z } from "zod";

import { cached, guard } from "@/lib/api";
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

  /*
   * Cached across everyone, not per client.
   *
   * This is the busiest route and the one that spends the scarcest budget:
   * every search fans out to YouTube Music, Deezer and Apple, and Apple allows
   * about 20 requests a minute for the whole deployment. Search results are
   * public catalogue data identical for every visitor, so there is nothing
   * personal to leak by sharing them — and sharing is the entire saving, since
   * the queries people type overlap almost completely.
   *
   * Case and surrounding space are folded into the key so "Levitating" and
   * "levitating " are one entry rather than two.
   */
  const key = `search:${parsed.data.limit}:${parsed.data.q.trim().toLowerCase()}`;

  const body = await cached(key, async () => {
    const { limiter } = getProviderRuntime();
    const { tracks, failures, attempted } = await searchAll(
      // Deliberately not `request.signal`. A cached call is shared, so aborting
      // it because *one* subscriber navigated away would cancel the answer
      // everyone else is waiting on.
      { limiter },
      parsed.data.q,
      parsed.data.limit,
    );

    // Failures are reported alongside results rather than thrown: one source
    // being down is normal, and Timbre's whole premise is that there is more
    // than one. `attempted` travels with them so the client can tell a total
    // outage from a search that simply matched nothing.
    return { songs: mergeTracks(tracks), failures, attempted };
  });

  return Response.json(body);
}
