import { findSpotifyTrackId } from "@timbre/providers";
import { z } from "zod";

import { CACHE_CONTROL_DAY, json, queryRoute } from "@/lib/api";
import { getProviderRuntime } from "@/lib/providers";
import { optionalQueryText, queryText } from "@/lib/query-text";

export const dynamic = "force-dynamic";

const hits = new Map<string, string>();

export const GET = queryRoute(
  z.object({
    title: queryText(300),
    artist: optionalQueryText(200),
    album: optionalQueryText(300),
    isrc: optionalQueryText(24),
  }),
  "A track title is required.",
  async ({ title, artist, album, isrc }, request) => {
    if (!album && !isrc) return Response.json({ trackId: null });

    const key = JSON.stringify([isrc, artist, album, title]);
    const ctx = { ...getProviderRuntime(), signal: request.signal };
    const trackId =
      hits.get(key) ?? (await findSpotifyTrackId(ctx, { title, artist, album, isrc }));
    if (trackId && !hits.has(key)) {
      if (hits.size >= 500) hits.delete(hits.keys().next().value!);
      hits.set(key, trackId);
    }
    return json({ trackId }, trackId ? CACHE_CONTROL_DAY : "no-store");
  },
);
