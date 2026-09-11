import { z } from "zod";

import { CACHE_CONTROL_DAY, guard } from "@/lib/api";
import { queryFlag, queryText } from "@/lib/query-text";
import { fetchDiscography, findArtist } from "@/lib/discography";

export const revalidate = 86_400;

const querySchema = z.object({
  name: queryText(200),
  full: queryFlag,
});

export async function GET(request: Request) {
  const refusal = guard(request);
  if (refusal) return refusal;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    name: url.searchParams.get("name"),
    full: url.searchParams.get("full") ?? undefined,
  });

  if (!parsed.success) {
    return Response.json({ error: "An artist name is required." }, { status: 400 });
  }

  const artist = await findArtist(parsed.data.name);

  if (!artist) return Response.json({ artist: null }, { status: 200 });

  const headers = { "cache-control": CACHE_CONTROL_DAY };

  if (!parsed.data.full) {
    return Response.json({ artist, releases: [], related: [] }, { headers });
  }

  const { releases, related } = await fetchDiscography(artist.url);

  return Response.json(
    {
      artist,
      releases,
      related,
    },
    { headers },
  );
}
