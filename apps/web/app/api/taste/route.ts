import { z } from "zod";

import { CACHE_CONTROL_DAY, json, queryRoute } from "@/lib/api";
import { deezerRefusal } from "@/lib/deezer";
import { queryText } from "@/lib/query-text";
import { fetchArtistTaste } from "@/lib/taste";

export const revalidate = 86_400;

export const GET = queryRoute(
  z.object({ artist: queryText(200) }),
  "An artist name is required.",
  async ({ artist }) => {
    try {
      return json({ taste: await fetchArtistTaste(artist) }, CACHE_CONTROL_DAY);
    } catch (error) {
      // `taste-store.ts` writes whatever a 200 carries into the reader's own browser and keeps it
      // there for a week, so a degraded answer here outlives the outage twice over. See
      // `deezerRefusal`.
      const refusal = deezerRefusal(error);
      if (!refusal) throw error;
      return refusal;
    }
  },
);
