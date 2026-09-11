import { ProviderError } from "@timbre/core";
import { searchSpotifyWeb } from "@timbre/providers";
import { z } from "zod";

import { cached, json, queryRoute, reportFailures } from "@/lib/api";
import { getProviderRuntime } from "@/lib/providers";
import { queryText } from "@/lib/query-text";

export const dynamic = "force-dynamic";

export const GET = queryRoute(
  z.object({ q: queryText(200) }),
  "A search query is required.",
  async ({ q }) => {
    const runtime = getProviderRuntime();
    try {
      const tracks = await cached(`spotify-web:${q.toLowerCase()}`, () =>
        searchSpotifyWeb(runtime, q, 10).catch((cause: unknown) => {
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
      return json({ songs }, "public, s-maxage=600, stale-while-revalidate=3600");
    } catch (cause) {
      const message =
        cause instanceof ProviderError && cause.kind === "rate_limited"
          ? "Spotify is rate-limiting Timbre just now. Try again shortly."
          : "Spotify's catalogue did not answer.";
      return Response.json(
        { error: message },
        { status: 502, headers: { "cache-control": "no-store" } },
      );
    }
  },
);
