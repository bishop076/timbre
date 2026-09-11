import { normalizeLoose } from "@timbre/core";
import { z } from "zod";

import { CACHE_CONTROL_DAY, guard } from "@/lib/api";
import { getProviderRuntime, getYtMusicLyrics } from "@/lib/providers";
import { queryText } from "@/lib/query-text";

/*
 * Lyrics from YouTube Music, the alternative to LRCLIB the lyrics panel offers when the song
 * has a YouTube copy. YouTube Music files lyrics under a song's art track, and the music
 * videos Timbre prefers to play carry none — so the panel sends any art tracks it knows of as
 * repeated `id`s, and the title and artist for the sidecar to find one when it knows none.
 *
 * Answers in the LRCLIB route's shape, with the licensor's `attribution` added, so the panel
 * draws either the same way.
 */

const querySchema = z.object({
  title: queryText(300),
  artist: queryText(300),
  /** Art tracks' video ids, pinned to the sidecar's own pattern and bound so a bad request is
   * a 400 here rather than a 422 relayed from there. */
  ids: z.array(z.string().regex(/^[A-Za-z0-9_-]{11}$/)).max(3),
});

/**
 * The title without a leading "Artist - ", which uploads outside the catalogue often carry.
 * The sidecar sets aside everything after a " - " as an aside like "- Remastered", so left in
 * place the artist's name would be all of the title it compared. Bracketed asides such as
 * "(Official Video)" are left for the sidecar, which strips them from both sides alike.
 */
function withoutArtistPrefix(title: string, artist: string): string {
  const [head, ...rest] = title.split(/\s+[-–—]\s+/);
  return rest.length > 0 && head && normalizeLoose(head) === normalizeLoose(artist)
    ? rest.join(" - ")
    : title;
}

/** Found lyrics are stable for a song. "None" and failures are left uncached, as in the LRCLIB
 * route: lyrics do arrive later, and a failure is not an answer. */
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
          // YouTube Music has no instrumental flag; an instrumental simply has no lyrics tab.
          instrumental: false,
          synced: found.synced,
          plain: found.plain,
          attribution: found.attribution,
        },
      },
      CACHEABLE,
    );
  } catch {
    // The sidecar is down, or YouTube turned it away. Said as a failure rather than as "no
    // lyrics", because the reader can do something about it — switch back to LRCLIB.
    return Response.json(
      { lyrics: null, error: "YouTube Music did not answer." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
