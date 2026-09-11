import { normalizeLoose } from "@timbre/core";
import { z } from "zod";

import { CACHE_CONTROL_DAY, guard } from "@/lib/api";
import { getProviderRuntime, getYtMusicLyrics } from "@/lib/providers";
import { queryText } from "@/lib/query-text";

const querySchema = z.object({
  title: queryText(300),
  artist: queryText(300),
  ids: z.array(z.string().regex(/^[A-Za-z0-9_-]{11}$/)).max(3),
});

function withoutArtistPrefix(title: string, artist: string): string {
  const [head, ...rest] = title.split(/\s+[-–—]\s+/);
  return rest.length > 0 && head && normalizeLoose(head) === normalizeLoose(artist)
    ? rest.join(" - ")
    : title;
}

const CACHEABLE = { headers: { "cache-control": CACHE_CONTROL_DAY } };

export async function GET(request: Request) {
  const refusal = guard(request);
  if (refusal) return refusal;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    title: url.searchParams.get("title"),
    artist: url.searchParams.get("artist"),
    ids: url.searchParams.getAll("id"),
  });
  if (!parsed.success) {
    return Response.json({ error: "A title and artist are required." }, { status: 400 });
  }

  const { title, artist, ids } = parsed.data;
  const { limiter } = getProviderRuntime();

  try {
    const found = await getYtMusicLyrics()(
      { limiter, signal: request.signal },
      { videoIds: ids, title: withoutArtistPrefix(title, artist), artist },
    );
    if (!found) return Response.json({ lyrics: null }, { status: 200 });

    return Response.json(
      {
        lyrics: {
          instrumental: false,
          synced: found.synced,
          plain: found.plain,
          attribution: found.attribution,
        },
      },
      CACHEABLE,
    );
  } catch {
    return Response.json(
      { lyrics: null, error: "YouTube Music did not answer." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
