import { ProviderError } from "@timbre/core";
import { searchSpotifyWeb } from "@timbre/providers";
import { z } from "zod";

import { cached, guard, reportFailures } from "@/lib/api";
import { getProviderRuntime } from "@/lib/providers";
import { queryText } from "@/lib/query-text";

export const dynamic = "force-dynamic";

const CACHE_CONTROL = "public, s-maxage=600, stale-while-revalidate=3600";

const querySchema = z.object({ q: queryText(200) });

export async function GET(request: Request) {
  const refusal = guard(request);
  if (refusal) return refusal;

  const parsed = querySchema.safeParse({ q: new URL(request.url).searchParams.get("q") });
  if (!parsed.success) {
    return Response.json({ error: "A search query is required." }, { status: 400 });
  }

  const { q } = parsed.data;
  const { limiter } = getProviderRuntime();

  try {
    const tracks = await cached(`spotify-web:${q.toLowerCase()}`, () =>
      searchSpotifyWeb({ limiter }, q, 10).catch((cause: unknown) => {
        reportFailures("/api/spotify/search", [
          { source: "spotify", message: cause instanceof Error ? cause.message : String(cause) },
        ]);
        throw cause;
      }),
    );

    const songs = tracks.map((track) => ({
      id: `spotify:${track.sourceId}`,
      title: track.title,
      artists: track.artists,
      album: track.album,
      durationMs: track.durationMs,
      isrc: track.isrc,
      artworkUrl: track.artworkUrl,
      sources: [track],
    }));

    return Response.json({ songs }, { headers: { "cache-control": CACHE_CONTROL } });
  } catch (cause) {
    const message =
      cause instanceof ProviderError && cause.kind === "rate_limited"
        ? "Spotify is rate-limiting Timbre just now. Try again shortly."
        : "Spotify's catalogue did not answer.";
    return Response.json({ error: message }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
