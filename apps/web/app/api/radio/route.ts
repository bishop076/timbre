import { isSourceId, recommendFrom } from "@timbre/providers";
import { z } from "zod";

import { getProviderRuntime } from "@/lib/providers";
import { guard } from "@/lib/api";

/**
 * What to play next.
 *
 * Not a passthrough of YouTube Music's watch queue. Every source that can
 * answer contributes a ranked list, and the lists are **fused** — a song
 * several of them reach independently outranks any one list's favourite. That
 * comparison is the only recommendation signal Timbre can produce that no
 * single service can produce for itself. See `recommend.ts`.
 *
 * Cached for an hour. The answer for a given seed is stable, and this is
 * fetched on every track change, so the cache is doing real work rather than
 * being decorative.
 */
export const revalidate = 3600;

const querySchema = z.object({
  // The seed's id on the source that will play it. YouTube Music continues
  // from a specific upload; Deezer can only start from an artist, so both are
  // passed and each provider takes what it can use.
  id: z.string().min(1).max(64).optional(),
  artist: z.string().min(1).max(200).optional(),
  // The seed's title, purely so the seed can be excluded from its own results.
  // YouTube Music drops it from its lists; Deezer's top tracks include it, so
  // without this the first suggestion is often the song that just played.
  title: z.string().min(1).max(300).optional(),
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

  // Present for symmetry with the other routes and for a future second
  // playable source; only YouTube Music can be driven today.
  const source = url.searchParams.get("source");
  if (source && !isSourceId(source)) {
    return Response.json({ error: `Unknown source "${source}".` }, { status: 400 });
  }

  const { limiter } = getProviderRuntime();
  const songs = await recommendFrom(
    { limiter, signal: request.signal },
    { sourceId: id, artist },
    limit,
    title && artist ? [{ title, artists: [artist] }] : undefined,
  );

  // **Always 200, even with nothing to say.** A failed radio and an empty one
  // produce the same UI — no shelf, no append, playback unaffected — so
  // distinguishing them would be ceremony the client cannot act on. Individual
  // source failures are already swallowed inside `recommendFrom`.
  return Response.json(
    { songs, failures: [] },
    {
      headers: {
        "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}
