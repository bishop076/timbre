import { z } from "zod";

import { guard } from "@/lib/api";
import { fetchGenres } from "@/lib/discover";
import { drawStations, fetchFresh } from "@/lib/genre-feed";
import { interleaveBy } from "@/lib/rotation";

/*
 * What is new and on air in one genre, for Explore's shelves. A pool larger than a shelf, so
 * the browser can deal a different handful from it on every visit; the pool itself turns
 * over with the stations, every quarter of an hour.
 */

/** The station period, and the reason it is not an hour — see `STATION_PERIOD_MS`. */
const CACHE_CONTROL_QUARTER = "public, s-maxage=900, stale-while-revalidate=3600";

const querySchema = z.object({ id: z.coerce.number().int().min(1).max(100_000) });

export async function GET(request: Request) {
  const refusal = guard(request);
  if (refusal) return refusal;

  const parsed = querySchema.safeParse({ id: new URL(request.url).searchParams.get("id") });
  if (!parsed.success) {
    return Response.json({ error: "A genre id is required." }, { status: 400 });
  }

  // Only a genre Deezer publishes, checked *before* anything is asked of it: the id reaches
  // Deezer's paths, and a made-up one would spend the deployment's shared quota on nothing.
  // The list is cached a week, so the check is free.
  const { id } = parsed.data;
  const genre = (await fetchGenres()).find((entry) => entry.id === id);
  if (!genre) return Response.json({ error: "No such genre." }, { status: 404 });

  const [fresh, drawn] = await Promise.all([fetchFresh(id), drawStations(id)]);

  // New releases and station songs in turn, so a shelf opens on both kinds.
  const songs = interleaveBy([fresh, drawn.tracks], (track) => track.id, 48);

  return Response.json(
    { genre: { id: genre.id, name: genre.name }, stations: drawn.stations, songs },
    { headers: { "cache-control": CACHE_CONTROL_QUARTER } },
  );
}
