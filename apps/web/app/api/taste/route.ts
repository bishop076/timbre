import { z } from "zod";

import { CACHE_CONTROL_DAY, json, queryRoute } from "@/lib/api";
import { queryText } from "@/lib/query-text";
import { fetchArtistTaste } from "@/lib/taste";

export const revalidate = 86_400;

export const GET = queryRoute(
  z.object({ artist: queryText(200) }),
  "An artist name is required.",
  async ({ artist }) => json({ taste: await fetchArtistTaste(artist) }, CACHE_CONTROL_DAY),
);
