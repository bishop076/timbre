import { recommendFrom } from "@timbre/providers";
import { z } from "zod";

import { CACHE_CONTROL_HOUR, json, queryRoute } from "@/lib/api";
import { log } from "@/lib/log";
import { getProviderRuntime } from "@/lib/providers";
import { optionalQueryText } from "@/lib/query-text";

export const revalidate = 3600;

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

    const songs = await recommendFrom(
      {
        ...getProviderRuntime(),
        signal: request.signal,
        report: (event, fields) => log("warn", event, { route: "/api/radio", ...fields }),
      },
      { sourceId: id, artist, title },
      limit,
      title && artist ? [{ title, artists: [artist] }] : undefined,
    );
    return json({ songs, failures: [] }, CACHE_CONTROL_HOUR);
  },
  { issues: true },
);
