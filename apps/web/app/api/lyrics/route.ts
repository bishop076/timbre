import { parseTitle } from "@timbre/core";
import { z } from "zod";

import { CACHE_CONTROL_DAY, guard } from "@/lib/api";
import { optionalQueryText, queryFlag, queryText } from "@/lib/query-text";
import { createBackoff, isBackoffSignal, type Backoff } from "@/lib/upstream-backoff";

export const revalidate = 86_400;

const USER_AGENT = "Timbre (https://github.com/bishop076/timbre)";

const globalForLyrics = globalThis as unknown as { __timbreLrclibBackoff?: Backoff };

function lrclibBackoff(): Backoff {
  return (globalForLyrics.__timbreLrclibBackoff ??= createBackoff({
    defaultSeconds: 30,
    maxSeconds: 600,
  }));
}

class LrclibBusy extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("LRCLIB is rate limiting this deployment.");
  }
}

async function lrclib(url: URL): Promise<Response> {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(6_000),
  });

  const retryAfter = response.headers.get("retry-after");
  if (isBackoffSignal(response.status, retryAfter)) {
    throw new LrclibBusy(lrclibBackoff().trip(retryAfter));
  }
  return response;
}

function busy(seconds: number, body: Record<string, unknown>): Response {
  return Response.json(
    { ...body, busy: true, error: "Lyrics are busy. Try again shortly." },
    {
      status: 503,
      headers: { "Retry-After": String(seconds), "cache-control": "no-store" },
    },
  );
}

const querySchema = z.object({
  title: queryText(300),
  artist: queryText(300),
  album: optionalQueryText(300),
  duration: z.coerce.number().int().positive().max(86_400).optional(),
  id: z.coerce.number().int().positive().optional(),
  alternatives: queryFlag,
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

function parseLrc(body: string): LyricLine[] {
  const lines: LyricLine[] = [];

  for (const raw of body.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (stamps.length === 0) continue;

    const text = raw.replace(/\[[^\]]*\]/g, "").trim();

    for (const stamp of stamps) {
      const minutes = Number(stamp[1]);
      const seconds = Number(stamp[2]);
      const fraction = stamp[3] ? Number(stamp[3]) / (stamp[3].length === 3 ? 1000 : 100) : 0;
      if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) continue;
      lines.push({ at: minutes * 60 + seconds + fraction, text });
    }
  }

  return lines.sort((a, b) => a.at - b.at);
}

async function lookup(url: URL): Promise<LrcLibTrack | null> {
  const response = await lrclib(url);

  if (!response.ok) return null;
  const body = (await response.json()) as unknown;
  return body && typeof body === "object" ? (body as LrcLibTrack) : null;
}

const CACHEABLE = { headers: { "cache-control": CACHE_CONTROL_DAY } };

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

  const waiting = lrclibBackoff().remainingSeconds();
  if (waiting > 0) return busy(waiting, alternatives ? { alternatives: [] } : { lyrics: null });

  const cleaned = parseTitle(title).base || title;

  try {
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
      }, CACHEABLE);
    }

    if (alternatives) {
      const search = new URL("https://lrclib.net/api/search");
      search.searchParams.set("track_name", cleaned);
      search.searchParams.set("artist_name", artist);

      const response = await lrclib(search);
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

    const exact = new URL("https://lrclib.net/api/get");
    exact.searchParams.set("track_name", cleaned);
    exact.searchParams.set("artist_name", artist);
    if (album) exact.searchParams.set("album_name", album);
    if (duration) exact.searchParams.set("duration", String(duration));

    let track = await lookup(exact);

    if (!track) {
      const search = new URL("https://lrclib.net/api/search");
      search.searchParams.set("track_name", cleaned);
      search.searchParams.set("artist_name", artist);

      const response = await lrclib(search);
      if (response.ok) {
        const results = (await response.json()) as LrcLibTrack[];
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
    }, CACHEABLE);
  } catch (error) {
    if (error instanceof LrclibBusy) {
      return busy(error.retryAfterSeconds, alternatives ? { alternatives: [] } : { lyrics: null });
    }
    return Response.json({ lyrics: null }, { status: 200 });
  }
}
