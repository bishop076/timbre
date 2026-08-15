import { parseTitle } from "@timbre/core";
import { z } from "zod";

import { guard } from "@/lib/api";

/*
 * Lyrics, from LRCLIB — the only keyless source licensing synced lines. Proxied rather
 * than called from the browser: it keeps the reader's IP away from a third party, makes
 * the response cacheable, and survives a blocker filtering the upstream host.
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
  /** A specific LRCLIB record, when the automatic match was wrong — one song routinely has a dozen entries. */
  id: z.coerce.number().int().positive().optional(),
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
  at: number;
  text: string;
}

// An LRC body as ordered lines. Blank entries are kept — an instrumental gap is part of
// the timing, and dropping it makes the highlight jump early.
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

  // YouTube Music titles carry noise — "(Official Video)", "[4K Remaster]" — that a
  // lyrics database has never heard of, so the matcher's parser strips it first.
  const cleaned = parseTitle(title).base || title;

  try {
    // An explicit pick wins outright: the reader already rejected the automatic one.
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

    // Instead of the lyrics, not alongside, so an ordinary track change is one request.
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

    // Exact lookup first — the only call that matches on duration, so covers lose.
    const exact = new URL("https://lrclib.net/api/get");
    exact.searchParams.set("track_name", cleaned);
    exact.searchParams.set("artist_name", artist);
    if (album) exact.searchParams.set("album_name", album);
    if (duration) exact.searchParams.set("duration", String(duration));

    let track = await lookup(exact);

    // Then a fuzzy search, forgiving a wrong album or an upload with an intro.
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
        // Prefer a result with timings; plain text is a consolation prize.
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
    // Upstream down or slow. The panel renders "no lyrics" either way.
    return Response.json({ lyrics: null }, { status: 200 });
  }
}
