import { parseTitle } from "@timbre/core";
import { z } from "zod";

import { guard } from "@/lib/api";

/**
 * Lyrics, from LRCLIB.
 *
 * Chosen because it is the only lyrics source that fits Timbre's rules: free,
 * **keyless**, no account, no quota worth worrying about, and community-owned.
 * Musixmatch and Genius both need a registered application, and Genius does not
 * license synced lines at all.
 *
 * Proxied rather than called from the browser for the same reasons as the
 * artwork proxy: it keeps the reader's IP and listening habits away from a
 * third party, it makes the response cacheable at the edge, and it survives a
 * content blocker that happens to filter the upstream host.
 *
 * **Synced lines are the point.** LRCLIB returns LRC timestamps when a track
 * has them, which is what makes a lyrics panel follow the music instead of
 * being a wall of text. Parsing happens here so the client receives something
 * it can render directly and every cache hit skips the work.
 */
export const revalidate = 86_400;

/** LRCLIB asks clients to identify themselves rather than spoof a browser. */
const USER_AGENT = "Timbre (https://github.com/bishop076/timbre)";

const querySchema = z.object({
  title: z.string().min(1).max(300),
  artist: z.string().min(1).max(300),
  album: z.string().max(300).optional(),
  /** Seconds. Used to pick between several matches of the same name. */
  duration: z.coerce.number().int().positive().max(86_400).optional(),
  /**
   * A specific LRCLIB record, when the automatic match was wrong.
   *
   * The database is community-contributed and one song routinely has a dozen
   * entries — different albums, different transcriptions, some off by a few
   * seconds. Picking the best of them automatically is a guess, so the reader
   * gets to overrule it.
   */
  id: z.coerce.number().int().positive().optional(),
  /** Ask for the candidate list instead of the lyrics themselves. */
  alternatives: z.coerce.boolean().optional(),
});

export interface LyricAlternative {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  duration: number | null;
  synced: boolean;
}

interface LrcLibTrack {
  trackName: string;
  artistName: string;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export interface LyricLine {
  /** Seconds from the start of the track. */
  at: number;
  text: string;
}

/**
 * Turns an LRC body into ordered lines.
 *
 * Blank entries are kept rather than dropped: an instrumental gap is part of
 * the timing, and removing it makes the highlight jump early. Malformed lines
 * are skipped silently — this is community-contributed data and one bad row
 * should not cost the whole song its lyrics.
 */
function parseLrc(body: string): LyricLine[] {
  const lines: LyricLine[] = [];

  for (const raw of body.split(/\r?\n/)) {
    // A line may carry several stamps for a repeated chorus.
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (stamps.length === 0) continue;

    const text = raw.replace(/\[[^\]]*\]/g, "").trim();

    for (const stamp of stamps) {
      const minutes = Number(stamp[1]);
      const seconds = Number(stamp[2]);
      // Two digits mean centiseconds, three mean milliseconds.
      const fraction = stamp[3] ? Number(stamp[3]) / (stamp[3].length === 3 ? 1000 : 100) : 0;
      if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) continue;
      lines.push({ at: minutes * 60 + seconds + fraction, text });
    }
  }

  return lines.sort((a, b) => a.at - b.at);
}

async function lookup(url: URL): Promise<LrcLibTrack | null> {
  const response = await fetch(url, {
    headers: {
      // LRCLIB asks clients to identify themselves rather than send a browser
      // user-agent, so that abuse can be attributed to a project.
      "user-agent": USER_AGENT,
    },
    signal: AbortSignal.timeout(6_000),
  });

  if (!response.ok) return null;
  const body = (await response.json()) as unknown;
  return body && typeof body === "object" ? (body as LrcLibTrack) : null;
}

export async function GET(request: Request) {
  const refusal = guard(request);
  if (refusal) return refusal;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    title: url.searchParams.get("title"),
    artist: url.searchParams.get("artist"),
    album: url.searchParams.get("album") ?? undefined,
    duration: url.searchParams.get("duration") ?? undefined,
    id: url.searchParams.get("id") ?? undefined,
    alternatives: url.searchParams.get("alternatives") ?? undefined,
  });

  if (!parsed.success) {
    return Response.json({ error: "A title and artist are required." }, { status: 400 });
  }

  const { title, artist, album, duration, id, alternatives } = parsed.data;

  /*
   * YouTube Music titles carry noise a lyrics database has never heard of —
   * "(Official Video)", "[4K Remaster]", "| Lyrics". Querying with that raw
   * string misses almost everything, so the same parser the matcher uses
   * strips it down to the base title first.
   */
  const cleaned = parseTitle(title).base || title;

  try {
    /*
     * An explicit pick wins outright — no matching, no ranking. The reader has
     * already seen the automatic answer and rejected it.
     */
    if (id) {
      const chosen = await lookup(new URL(`https://lrclib.net/api/get/${id}`));
      if (!chosen) return Response.json({ lyrics: null }, { status: 200 });
      return Response.json({
        lyrics: {
          instrumental: chosen.instrumental,
          synced: chosen.syncedLyrics ? parseLrc(chosen.syncedLyrics) : null,
          plain: chosen.plainLyrics,
          matchedTitle: chosen.trackName,
          matchedArtist: chosen.artistName,
          id,
        },
      });
    }

    /*
     * The candidate list, for the picker. Returned instead of lyrics rather
     * than alongside them: the panel only asks once the reader opens the
     * chooser, so every ordinary track change stays a single request.
     */
    if (alternatives) {
      const search = new URL("https://lrclib.net/api/search");
      search.searchParams.set("track_name", cleaned);
      search.searchParams.set("artist_name", artist);

      const response = await fetch(search, {
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(6_000),
      });
      if (!response.ok) return Response.json({ alternatives: [] }, { status: 200 });

      const results = (await response.json()) as (LrcLibTrack & {
        id: number;
        albumName?: string;
        duration?: number;
      })[];

      return Response.json({
        alternatives: results.slice(0, 20).map(
          (item): LyricAlternative => ({
            id: item.id,
            trackName: item.trackName,
            artistName: item.artistName,
            albumName: item.albumName ?? null,
            duration: item.duration ?? null,
            synced: Boolean(item.syncedLyrics),
          }),
        ),
      });
    }

    // Exact lookup first: it is the only call that can return synced lines
    // matched on duration, which is what keeps a cover from winning.
    const exact = new URL("https://lrclib.net/api/get");
    exact.searchParams.set("track_name", cleaned);
    exact.searchParams.set("artist_name", artist);
    if (album) exact.searchParams.set("album_name", album);
    if (duration) exact.searchParams.set("duration", String(duration));

    let track = await lookup(exact);

    // Then a fuzzy search, which forgives a wrong album or a duration that is
    // a few seconds out because the upload has an intro.
    if (!track) {
      const search = new URL("https://lrclib.net/api/search");
      search.searchParams.set("track_name", cleaned);
      search.searchParams.set("artist_name", artist);

      const response = await fetch(search, {
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(6_000),
      });
      if (response.ok) {
        const results = (await response.json()) as LrcLibTrack[];
        // Prefer a result that actually has timings; a plain-text match is a
        // consolation prize rather than an equal one.
        track =
          results.find((item) => item.syncedLyrics) ?? results[0] ?? null;
      }
    }

    if (!track) {
      return Response.json({ lyrics: null }, { status: 200 });
    }

    return Response.json({
      lyrics: {
        instrumental: track.instrumental,
        synced: track.syncedLyrics ? parseLrc(track.syncedLyrics) : null,
        plain: track.plainLyrics,
        matchedTitle: track.trackName,
        matchedArtist: track.artistName,
      },
    });
  } catch {
    // Upstream down or slow. A missing lyric sheet is not an error worth
    // failing the panel over — it renders "no lyrics" either way.
    return Response.json({ lyrics: null }, { status: 200 });
  }
}
