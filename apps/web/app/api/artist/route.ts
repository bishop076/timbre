import { z } from "zod";

import { guard } from "@/lib/api";
import { fetchDiscography, findArtist } from "@/lib/discography";

/*
 * Who an artist is, and what they have released. No artist profile can be embedded, so the
 * discography is assembled from Deezer, which publishes releases by kind keyless. `?full=1`
 * asks for it — the now-playing card runs on every track change, so the default is one lookup.
 */
export const revalidate = 86_400;

const querySchema = z.object({
  name: z.string().min(1).max(200),
  full: z.coerce.boolean().optional(),
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

  // Not found is a normal answer: plenty of uploads name someone no catalogue
  // carries, and the panel just omits the card.
  if (!artist) return Response.json({ artist: null }, { status: 200 });

  const headers = {
    "cache-control": "public, s-maxage=86400, stale-while-revalidate=604800",
  };

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
