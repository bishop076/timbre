import { mergeTracks, searchAll } from "@timbre/providers";
import { z } from "zod";

import { cached, queryRoute, reportFailures } from "@/lib/api";
import { getProviderRuntime } from "@/lib/providers";
import { queryText } from "@/lib/query-text";

export const dynamic = "force-dynamic";

export const GET = queryRoute(
  z.object({ q: queryText(200), limit: z.coerce.number().int().min(1).max(50).default(20) }),
  "A search query is required.",
  async ({ q, limit }) => {
    const body = await cached(`search:${limit}:${q.toLowerCase()}`, async () => {
      const { tracks, failures, attempted } = await searchAll(getProviderRuntime(), q, limit);
      reportFailures("/api/search", failures);
      return { songs: mergeTracks(tracks), failures, attempted };
    });
    return Response.json(body);
  },
  { issues: true },
);
