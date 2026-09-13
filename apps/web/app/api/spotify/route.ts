import { findSpotifyTrackId } from "@timbre/providers";
import { z } from "zod";

import { CACHE_CONTROL_DAY, json, queryRoute } from "@/lib/api";
import { getProviderRuntime } from "@/lib/providers";
import { optionalQueryText, queryText } from "@/lib/query-text";

export const dynamic = "force-dynamic";

// A module-scope Map with no timestamp and no expiry: one wrong or since-retired track id was
// pinned for the life of the server process, served to every reader, under a day of
// cache-control on top. FIFO at 500 was the only eviction, so a busy process never reached it.
const HIT_TTL_MS = 6 * 60 * 60 * 1000;
const HIT_MAX = 500;

const hits = new Map<string, { trackId: string; at: number }>();

function remembered(key: string): string | null {
  const hit = hits.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at < HIT_TTL_MS) return hit.trackId;
  hits.delete(key);
  return null;
}

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
      remembered(key) ?? (await findSpotifyTrackId(ctx, { title, artist, album, isrc }));
    if (trackId && !hits.has(key)) {
      if (hits.size >= HIT_MAX) hits.delete(hits.keys().next().value!);
      hits.set(key, { trackId, at: Date.now() });
    }
    return json({ trackId }, trackId ? CACHE_CONTROL_DAY : "no-store");
  },
);
