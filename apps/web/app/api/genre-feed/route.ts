import { z } from "zod";

import { guard } from "@/lib/api";
import { fetchGenres } from "@/lib/discover";
import { drawStations, fetchFresh } from "@/lib/genre-feed";
import { interleaveBy } from "@/lib/rotation";

const CACHE_CONTROL_QUARTER = "public, s-maxage=900, stale-while-revalidate=3600";

const querySchema = z.object({ id: z.coerce.number().int().min(1).max(100_000) });

export async function GET(request: Request) {
  const refusal = guard(request);
  if (refusal) return refusal;

  const parsed = querySchema.safeParse({ id: new URL(request.url).searchParams.get("id") });
  if (!parsed.success) {
    return Response.json({ error: "A genre id is required." }, { status: 400 });
  }

  const { id } = parsed.data;
  const genre = (await fetchGenres()).find((entry) => entry.id === id);
  if (!genre) return Response.json({ error: "No such genre." }, { status: 404 });

  const [fresh, drawn] = await Promise.all([fetchFresh(id), drawStations(id)]);

  const songs = interleaveBy([fresh, drawn.tracks], (track) => track.id, 48);

  return Response.json(
    { genre: { id: genre.id, name: genre.name }, stations: drawn.stations, songs },
    { headers: { "cache-control": CACHE_CONTROL_QUARTER } },
  );
}
