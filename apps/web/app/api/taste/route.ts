import { z } from "zod";

import { CACHE_CONTROL_DAY, guard } from "@/lib/api";
import { queryText } from "@/lib/query-text";
import { fetchArtistTaste } from "@/lib/taste";

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

  const taste = await fetchArtistTaste(parsed.data.artist);
  return Response.json({ taste }, { headers: { "cache-control": CACHE_CONTROL_DAY } });
}
