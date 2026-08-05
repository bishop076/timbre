import { z } from "zod";

import { guard } from "@/lib/api";
import { fetchDiscography, findArtist } from "@/lib/discography";

/**
 * Who an artist is, and what they have released.
 *
 * **There is no way to embed somebody else's artist profile.** Spotify does
 * publish an artist embed, but reaching it needs a track or artist id from an
 * API that now requires a paid developer account — and the free service that
 * used to map a song onto its Spotify equivalent shut down in July 2026. YouTube
 * Music has no artist embed at all. So a real discography cannot be borrowed; it
 * has to be assembled.
 *
 * Deezer turns out to publish the whole thing keyless: releases tagged by kind,
 * top tracks, and neighbouring artists. That is enough to build an artist page
 * with albums, EPs and singles on it — Timbre's own page, from somebody else's
 * catalogue, which is the same trade the rest of the app makes.
 *
 * `?full=1` asks for the discography. The now-playing card does not need it and
 * is called on every track change, so it stays a cheap single lookup by default.
 */
export const revalidate = 86_400;

const querySchema = z.object({
  name: z.string().min(1).max(200),
  full: z.coerce.boolean().optional(),
});

export async function GET(request: Request) {
  const refusal = guard(request);
  if (refusal) return refusal;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    name: url.searchParams.get("name"),
    full: url.searchParams.get("full") ?? undefined,
  });

  if (!parsed.success) {
    return Response.json({ error: "An artist name is required." }, { status: 400 });
  }

  const artist = await findArtist(parsed.data.name);

  // Not found is a normal answer, not an error: plenty of uploads name someone
  // no catalogue carries. The panel simply omits the card.
  if (!artist) return Response.json({ artist: null }, { status: 200 });

  const headers = {
    "cache-control": "public, s-maxage=86400, stale-while-revalidate=604800",
  };

  if (!parsed.data.full) {
    return Response.json({ artist, releases: [], related: [] }, { headers });
  }

  const { releases, related } = await fetchDiscography(artist.url);

  return Response.json(
    {
      artist,
      releases,
      related,
    },
    { headers },
  );
}
