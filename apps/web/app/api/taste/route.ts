import { z } from "zod";

import { CACHE_CONTROL_DAY, guard } from "@/lib/api";
import { queryText } from "@/lib/query-text";
import { fetchArtistTaste } from "@/lib/taste";

/*
 * One artist's genre and newest releases, for Explore to follow what this browser plays.
 * One name per request, never a list: the same URL for everyone who played that artist, so
 * the CDN answers most of them, and nothing here ever holds more of a history than a search.
 */
export const revalidate = 86_400;

const querySchema = z.object({ artist: queryText(200) });

export async function GET(request: Request) {
  const refusal = guard(request);
  if (refusal) return refusal;

  const parsed = querySchema.safeParse({
    artist: new URL(request.url).searchParams.get("artist"),
  });
  if (!parsed.success) {
    return Response.json({ error: "An artist name is required." }, { status: 400 });
  }

  // Not found is an answer worth caching too: the browser files the name as "no genre" and
  // stops asking, rather than asking on every visit.
  const taste = await fetchArtistTaste(parsed.data.artist);
  return Response.json({ taste }, { headers: { "cache-control": CACHE_CONTROL_DAY } });
}
