import { parseTitle } from "@timbre/core";
import { z } from "zod";

import { CACHE_CONTROL_DAY, guard } from "@/lib/api";
import { optionalQueryText, queryFlag, queryText } from "@/lib/query-text";
import { createBackoff, isBackoffSignal, type Backoff } from "@/lib/upstream-backoff";

/*
 * Lyrics, from LRCLIB — the only keyless source licensing synced lines. Proxied rather
 * than called from the browser: it keeps the reader's IP away from a third party, makes
 * the response cacheable, and survives a blocker filtering the upstream host.
 */
export const revalidate = 86_400;

/** LRCLIB asks clients to identify themselves rather than spoof a browser. */
const USER_AGENT = "Timbre (https://github.com/bishop076/timbre)";

/*
 * LRCLIB's "not now", honoured (docs/EXPOSURE.md E-18, RESEARCH-2026-08-20 G-10). Being
 * proxied makes every reader one client to LRCLIB, so its 429 is addressed to the whole
 * deployment — and it goes out of its way to say for how long, exposing `Retry-After` even
 * to browsers. This route used to read neither and answer "no lyrics", which let every
 * track change keep asking through the refusal. Now the instance stops calling until the
 * header's time has passed and tells readers the lyrics are busy, not missing.
 *
 * Cached on `globalThis` like the limiters in `lib/api.ts`, so a hot reload does not forget
 * a refusal. Thirty seconds when LRCLIB names no time; never more than ten minutes, past
 * which one probing request costs less than a misread header silencing lyrics for an hour.
 */
const globalForLyrics = globalThis as unknown as { __timbreLrclibBackoff?: Backoff };

function lrclibBackoff(): Backoff {
  return (globalForLyrics.__timbreLrclibBackoff ??= createBackoff({
    defaultSeconds: 30,
    maxSeconds: 600,
  }));
}

/** LRCLIB refused, and how long this instance is now waiting before asking again. */
class LrclibBusy extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("LRCLIB is rate limiting this deployment.");
  }
}

/** Every call to LRCLIB, so none can skip the refusal check. */
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

/**
 * "Busy", distinct from "none": a 503 with the wait passed on, so the panel can say so and
 * come back when it is over rather than at once. Never cached — at the edge it would outlive
 * the refusal it describes by a day.
 */
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
  /** Seconds. Used to pick between several matches of the same name. */
  duration: z.coerce.number().int().positive().max(86_400).optional(),
  /** A specific LRCLIB record, when the automatic match was wrong — one song routinely has a dozen entries. */
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
  const response = await lrclib(url);

  if (!response.ok) return null;
  const body = (await response.json()) as unknown;
  return body && typeof body === "object" ? (body as LrcLibTrack) : null;
}

/**
 * Lyrics found are stable: LRCLIB records do not change under their id, and the exact match
 * for one title and artist does not either. Nothing was cached before this — the comment at
 * the top promised it and the `revalidate` export is inert on a handler that reads the
 * request — so every track change was a live round trip, two when the exact lookup missed.
 * "Not found" and the alternatives list are left uncached: lyrics do arrive later.
 */
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

  // Checked before anything goes out: while LRCLIB's wait runs, asking again only extends it.
  const waiting = lrclibBackoff().remainingSeconds();
  if (waiting > 0) return busy(waiting, alternatives ? { alternatives: [] } : { lyrics: null });

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
      }, CACHEABLE);
    }

    // Instead of the lyrics, not alongside, so an ordinary track change is one request.
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

      const response = await lrclib(search);
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
    }, CACHEABLE);
  } catch (error) {
    if (error instanceof LrclibBusy) {
      return busy(error.retryAfterSeconds, alternatives ? { alternatives: [] } : { lyrics: null });
    }
    // Upstream down or slow. The panel renders "no lyrics" either way.
    return Response.json({ lyrics: null }, { status: 200 });
  }
}
