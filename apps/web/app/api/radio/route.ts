import { isSourceId, recommendFrom } from "@timbre/providers";
import { z } from "zod";

import { getProviderRuntime } from "@/lib/providers";
import { optionalQueryText } from "@/lib/query-text";
import { CACHE_CONTROL_HOUR, guard } from "@/lib/api";

// What to play next — not a passthrough of YouTube Music's watch queue. Every source that
// can answer contributes a ranked list, and the lists are **fused**: a song several reach
// independently outranks any one list's favourite. See `recommend.ts`.
export const revalidate = 3600;

const querySchema = z.object({
  // All three passed, each provider taking what it can use: YouTube Music continues from
  // an upload, Deezer can only start from an artist, Audius only from a title.
  id: optionalQueryText(64),
  artist: optionalQueryText(200),
  // So the seed can be excluded from its own results: Deezer's top tracks include it,
  // so without this the first suggestion is often what just played.
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

  const source = url.searchParams.get("source");
  if (source && !isSourceId(source)) {
    return Response.json({ error: `Unknown source "${source}".` }, { status: 400 });
  }

  const { limiter } = getProviderRuntime();
  const songs = await recommendFrom(
    { limiter, signal: request.signal },
    { sourceId: id, artist, title },
    limit,
    title && artist ? [{ title, artists: [artist] }] : undefined,
  );

  // Always 200: a failed radio and an empty one produce the same UI.
  return Response.json(
    { songs, failures: [] },
    { headers: { "cache-control": CACHE_CONTROL_HOUR } },
  );
}
