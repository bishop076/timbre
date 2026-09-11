import { findSpotifyTrackId } from "@timbre/providers";
import { z } from "zod";

import { getProviderRuntime } from "@/lib/providers";
import { optionalQueryText, queryText } from "@/lib/query-text";
import { guard, CACHE_CONTROL_DAY } from "@/lib/api";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  title: queryText(300),
  artist: optionalQueryText(200),
  album: optionalQueryText(300),
  isrc: optionalQueryText(24),
});

const hits = new Map<string, string>();
const MAX_HITS = 500;

async function cachedHit(key: string, produce: () => Promise<string | null>): Promise<string | null> {
  const held = hits.get(key);
  if (held) return held;

  const found = await produce();
  if (!found) return null;

  if (hits.size >= MAX_HITS) {
    const oldest = hits.keys().next();
    if (!oldest.done) hits.delete(oldest.value);
  }
  hits.set(key, found);
  return found;
}

export async function GET(request: Request) {
  const refusal = guard(request);
  if (refusal) return refusal;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    title: url.searchParams.get("title") ?? undefined,
    artist: url.searchParams.get("artist") ?? undefined,
    album: url.searchParams.get("album") ?? undefined,
    isrc: url.searchParams.get("isrc") ?? undefined,
  });

  if (!parsed.success) {
    return Response.json({ error: "A track title is required." }, { status: 400 });
  }

  const { title, artist, album, isrc } = parsed.data;

  if (!album && !isrc) return Response.json({ trackId: null }, { status: 200 });

  const { limiter } = getProviderRuntime();
  const key = `spotify:${isrc ?? ""}:${artist ?? ""}:${album ?? ""}:${title}`;

  const trackId = await cachedHit(key, () =>
    findSpotifyTrackId({ limiter, signal: request.signal }, { title, artist, album, isrc }),
  );

  return Response.json(
    { trackId: trackId ?? null },
    { headers: { "cache-control": trackId ? CACHE_CONTROL_DAY : "no-store" } },
  );
}
