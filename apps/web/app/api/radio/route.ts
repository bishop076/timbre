import { recommendFrom } from "@timbre/providers";
import { z } from "zod";

import { getProviderRuntime } from "@/lib/providers";
import { optionalQueryText } from "@/lib/query-text";
import { CACHE_CONTROL_HOUR, guard } from "@/lib/api";
import { log } from "@/lib/log";

export const revalidate = 3600;

const querySchema = z.object({
  id: optionalQueryText(64),
  artist: optionalQueryText(200),
  title: optionalQueryText(300),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});

export async function GET(request: Request) {
  const refusal = guard(request);
  if (refusal) return refusal;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    id: url.searchParams.get("id") ?? undefined,
    artist: url.searchParams.get("artist") ?? undefined,
    title: url.searchParams.get("title") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    return Response.json(
      { error: "A seed track id or artist is required.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { id, artist, title, limit } = parsed.data;
  if (!id && !artist) {
    return Response.json({ error: "A seed track id or artist is required." }, { status: 400 });
  }

  const { limiter } = getProviderRuntime();
  const songs = await recommendFrom(
    {
      limiter,
      signal: request.signal,
      report: (event, fields) => log("warn", event, { route: "/api/radio", ...fields }),
    },
    { sourceId: id, artist, title },
    limit,
    title && artist ? [{ title, artists: [artist] }] : undefined,
  );

  return Response.json(
    { songs, failures: [] },
    { headers: { "cache-control": CACHE_CONTROL_HOUR } },
  );
}
