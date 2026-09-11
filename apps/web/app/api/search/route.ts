import { mergeTracks, searchAll } from "@timbre/providers";
import { z } from "zod";

import { cached, guard, reportFailures } from "@/lib/api";
import { queryText } from "@/lib/query-text";
import { getProviderRuntime } from "@/lib/providers";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: queryText(200),
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

  const key = `search:${parsed.data.limit}:${parsed.data.q.trim().toLowerCase()}`;

  const body = await cached(key, async () => {
    const { limiter } = getProviderRuntime();
    const { tracks, failures, attempted } = await searchAll(
      { limiter },
      parsed.data.q,
      parsed.data.limit,
    );

    reportFailures("/api/search", failures);
    return { songs: mergeTracks(tracks), failures, attempted };
  });

  return Response.json(body);
}
