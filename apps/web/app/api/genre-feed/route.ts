import { z } from "zod";

import { json, queryRoute } from "@/lib/api";
import { fetchGenres } from "@/lib/discover";
import { drawStations, fetchFresh } from "@/lib/genre-feed";
import { interleaveBy } from "@/lib/rotation";

export const GET = queryRoute(
  z.object({ id: z.coerce.number().int().min(1).max(100_000) }),
  "A genre id is required.",
  async ({ id }) => {
    const genre = (await fetchGenres()).find((entry) => entry.id === id);
    if (!genre) return Response.json({ error: "No such genre." }, { status: 404 });

    const [fresh, drawn] = await Promise.all([fetchFresh(id), drawStations(id)]);
    return json(
      {
        genre: { id: genre.id, name: genre.name },
        stations: drawn.stations,
        songs: interleaveBy([fresh, drawn.tracks], (track) => track.id, 48),
      },
      "public, s-maxage=900, stale-while-revalidate=3600",
    );
  },
);
