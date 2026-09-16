import { z } from "zod";

import { CACHE_CONTROL_DAY, json, queryRoute } from "@/lib/api";
import { deezerRefusal } from "@/lib/deezer";
import { fetchDiscography, findArtist } from "@/lib/discography";
import { queryFlag, queryText } from "@/lib/query-text";

export const GET = queryRoute(
  z.object({ name: queryText(200), full: queryFlag }),
  "An artist name is required.",
  async ({ name, full }) => {
    try {
      const artist = await findArtist(name);
      if (!artist) return Response.json({ artist: null });

      const { releases, related } = full
        ? await fetchDiscography(artist.url)
        : { releases: [], related: [] };
      return json({ artist, releases, related }, CACHE_CONTROL_DAY);
    } catch (error) {
      // Both reads behind this route are strict, so a Deezer outage arrives here as a throw and
      // used to leave as a bare 500. See `deezerRefusal`.
      const refusal = deezerRefusal(error);
      if (!refusal) throw error;
      return refusal;
    }
  },
);
