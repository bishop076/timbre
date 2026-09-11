import { normalizeLoose } from "@timbre/core";
import { z } from "zod";

import { CACHE_CONTROL_DAY, guard, json } from "@/lib/api";
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

export async function GET(request: Request) {
  const refusal = guard(request);
  if (refusal) return refusal;

  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({
    title: params.get("title"),
    artist: params.get("artist"),
    ids: params.getAll("id"),
  });
  if (!parsed.success) {
    return Response.json({ error: "A title and artist are required." }, { status: 400 });
  }

  const { title, artist, ids } = parsed.data;
  const runtime = getProviderRuntime();

  try {
    const found = await getYtMusicLyrics()(
      { ...runtime, signal: request.signal },
      { videoIds: ids, title: withoutArtistPrefix(title, artist), artist },
    );
    if (!found) return Response.json({ lyrics: null });

    return json(
      {
        lyrics: {
          instrumental: false,
          synced: found.synced,
          plain: found.plain,
          attribution: found.attribution,
        },
      },
      CACHE_CONTROL_DAY,
    );
  } catch {
    return Response.json(
      { lyrics: null, error: "YouTube Music did not answer." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
