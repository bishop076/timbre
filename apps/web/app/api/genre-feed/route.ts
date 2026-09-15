import { z } from "zod";

import { json, queryRoute } from "@/lib/api";
import { fetchGenres } from "@/lib/discover";
import { drawStations, fetchFresh, type FeedProbe } from "@/lib/genre-feed";
import { interleaveBy } from "@/lib/rotation";

const CACHED = "public, s-maxage=900, stale-while-revalidate=3600";

function unavailable(): Response {
  return Response.json(
    { error: "Deezer wouldn't answer for this genre just now.", degraded: true },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}

export const GET = queryRoute(
  z.object({ id: z.coerce.number().int().min(1).max(100_000) }),
  "A genre id is required.",
  async ({ id }) => {
    const genres = await fetchGenres();

    // Deezer's genre list is a fixed catalogue, so an empty one is never an answer: it is the
    // only shape a failed read has, because `fetchGenres` forgives every failure into `[]`.
    // Answering 404 "No such genre." off the back of that asserted the genre does not exist
    // from a request that never established anything of the sort — and on a cold instance
    // caught in a Deezer blip, it said that about every genre at once.
    if (genres.length === 0) return unavailable();

    const genre = genres.find((entry) => entry.id === id);
    if (!genre) return Response.json({ error: "No such genre." }, { status: 404 });

    const probe: FeedProbe = { failed: false };
    const [fresh, drawn] = await Promise.all([fetchFresh(id, probe), drawStations(id, probe)]);
    const songs = interleaveBy([fresh, drawn.tracks], (track) => track.id, 48);

    // The same shape `/api/charts`, `/api/radio` and `/api/search` already use: serve the best
    // that could be had, and never let the CDN remember one that is thin because something
    // broke. Empty *and* degraded is not a thin answer, it is no answer, so say so.
    if (probe.failed && songs.length === 0) return unavailable();

    return json(
      {
        genre: { id: genre.id, name: genre.name },
        stations: drawn.stations,
        songs,
        degraded: probe.failed,
      },
      probe.failed ? "no-store" : CACHED,
    );
  },
);
