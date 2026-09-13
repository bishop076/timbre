import { mergeTracks, searchAll } from "@timbre/providers";
import { z } from "zod";

import { cached, publicFailures, queryRoute, reportFailures, whole } from "@/lib/api";
import { getProviderRuntime } from "@/lib/providers";
import { queryText } from "@/lib/query-text";

export const dynamic = "force-dynamic";

export const GET = queryRoute(
  z.object({ q: queryText(200), limit: z.coerce.number().int().min(1).max(50).default(20) }),
  "A search query is required.",
  async ({ q, limit }) => {
    const body = await cached(
      `search:${limit}:${q.toLowerCase()}`,
      // Deliberately no `signal`: `cached` hands one in-flight promise to every caller waiting
      // on the same query, so one client navigating away would abort the search for all of
      // them. The cost is that an abandoned search runs to completion; the alternative is
      // cancelling someone else's.
      async () => {
        const { tracks, failures, attempted } = await searchAll(getProviderRuntime(), q, limit);
        reportFailures("/api/search", failures);
        return { songs: mergeTracks(tracks), failures: publicFailures(failures), attempted };
      },
      // A result missing a provider is not the answer to this query, only the best that could
      // be had at that moment; caching it served everyone the same gap for the full two
      // minutes, including after the provider came back.
      whole,
    );
    return Response.json(body);
  },
  { issues: true },
);
