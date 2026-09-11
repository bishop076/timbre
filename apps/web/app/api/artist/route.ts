import { z } from "zod";

import { CACHE_CONTROL_DAY, json, queryRoute } from "@/lib/api";
import { fetchDiscography, findArtist } from "@/lib/discography";
import { queryFlag, queryText } from "@/lib/query-text";

export const revalidate = 86_400;

export const GET = queryRoute(
  z.object({ name: queryText(200), full: queryFlag }),
  "An artist name is required.",
  async ({ name, full }) => {
    const artist = await findArtist(name);
    if (!artist) return Response.json({ artist: null });

    const { releases, related } = full
      ? await fetchDiscography(artist.url)
      : { releases: [], related: [] };
    return json({ artist, releases, related }, CACHE_CONTROL_DAY);
  },
);
