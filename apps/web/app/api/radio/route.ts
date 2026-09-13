import { recommendFrom } from "@timbre/providers";
import { z } from "zod";

import { CACHE_CONTROL_HOUR, json, publicFailures, queryRoute } from "@/lib/api";
import { log } from "@/lib/log";
import { getProviderRuntime } from "@/lib/providers";
import { optionalQueryText } from "@/lib/query-text";

export const GET = queryRoute(
  z.object({
    id: optionalQueryText(64),
    artist: optionalQueryText(200),
    title: optionalQueryText(300),
    limit: z.coerce.number().int().min(1).max(50).default(25),
  }),
  "A seed track id or artist is required.",
  async ({ id, artist, title, limit }, request) => {
    if (!id && !artist) {
      return Response.json({ error: "A seed track id or artist is required." }, { status: 400 });
    }

    const failures: { source: string; message: string }[] = [];
    const songs = await recommendFrom(
      {
        ...getProviderRuntime(),
        signal: request.signal,
        report: (event, fields) => {
          log("warn", event, { route: "/api/radio", ...fields });
          const { source, error } = fields as { source?: string; error?: unknown };
          if (source) {
            failures.push({
              source,
              message: error instanceof Error ? error.message : String(error ?? "failed"),
            });
          }
        },
      },
      { sourceId: id, artist, title },
      limit,
      title && artist ? [{ title, artists: [artist] }] : undefined,
    );

    // `recommendFrom` allSettles and maps every rejection to `[]`, so "every provider is down"
    // and "this seed has no recommendations" arrived here as the same value — and the route
    // then hardcoded `failures: []` and pinned it to the CDN for an hour with a day of
    // stale-while-revalidate. An hour of silent dead-ends bought from one transient blip.
    // Report what failed, and refuse to cache an answer that is empty because something broke.
    const broken = failures.length > 0 && songs.length === 0;
    return json({ songs, failures: publicFailures(failures) }, broken ? "no-store" : CACHE_CONTROL_HOUR);
  },
  { issues: true },
);
