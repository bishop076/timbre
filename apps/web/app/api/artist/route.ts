import { lookupArtist } from "@timbre/providers";
import { z } from "zod";

import { getProviderRuntime } from "@/lib/providers";

/**
 * Who an artist is, for the now-playing panel.
 *
 * Deezer is the only free source that publishes a picture and a follower count
 * without a key. There is no biography here because no keyless source gives
 * one — an "about the artist" card that made up prose about a real person would
 * be worse than no card.
 *
 * Cached for a day: an artist's picture does not change between songs, and this
 * is called on every track change.
 */
export const revalidate = 86_400;

const querySchema = z.object({
  name: z.string().min(1).max(200),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ name: url.searchParams.get("name") });

  if (!parsed.success) {
    return Response.json({ error: "An artist name is required." }, { status: 400 });
  }

  const { limiter } = getProviderRuntime();
  const artist = await lookupArtist({ limiter, signal: request.signal }, parsed.data.name);

  // Not found is a normal answer, not an error: plenty of uploads name someone
  // no catalogue carries. The panel simply omits the card.
  if (!artist) return Response.json({ artist: null }, { status: 200 });

  return Response.json(
    { artist },
    { headers: { "cache-control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
  );
}
