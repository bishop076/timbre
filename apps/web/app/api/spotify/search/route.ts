import { ProviderError } from "@timbre/core";
import { searchSpotifyWeb } from "@timbre/providers";
import { z } from "zod";

import { cached, guard } from "@/lib/api";
import { getProviderRuntime } from "@/lib/providers";
import { queryText } from "@/lib/query-text";

// Spotify's catalogue, searched without an account — see `spotify-web.ts` for how. Server-side
// because the anonymous token must never reach a browser: it is one per deployment, and
// handing it out would let anyone spend this server's standing with Spotify.
//
// **Its own route, not a provider in `searchAll`.** The results render in their own section
// beneath the blended list and never merge into it — see `spotify-section.tsx` for why.
export const dynamic = "force-dynamic";

/** Ten minutes at the edge: a catalogue answer, which moves on the scale of releases. */
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
    // No caller signal, as `/api/search` does: a cached call is shared, and one reader typing
    // on must not cancel the answer another is waiting for.
    const tracks = await cached(`spotify-web:${q.toLowerCase()}`, () => searchSpotifyWeb({ limiter }, q, 10));

    const songs = tracks.map((track) => ({
      // Namespaced, like the account-backed search's: these render beside merged songs,
      // whose ids are ISRCs or dedupe keys, and React keys must not meet.
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
    // A 502 rather than an empty list: the section falls back to the reader's own account
    // when there is one, and has to be able to tell "nothing found" from "Spotify refused".
    const message =
      cause instanceof ProviderError && cause.kind === "rate_limited"
        ? "Spotify is rate-limiting Timbre just now. Try again shortly."
        : "Spotify's catalogue did not answer.";
    return Response.json({ error: message }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
