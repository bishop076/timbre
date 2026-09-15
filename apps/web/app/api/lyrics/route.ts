import { parseTitle } from "@timbre/core";
import { z } from "zod";

import { CACHE_CONTROL_DAY, json, queryRoute } from "@/lib/api";
import { describeError, log } from "@/lib/log";
import { optionalQueryText, queryFlag, queryText } from "@/lib/query-text";
import { createBackoff, isBackoffSignal, type Backoff } from "@/lib/upstream-backoff";

const globalForLyrics = globalThis as unknown as { __timbreLrclibBackoff?: Backoff };

function lrclibBackoff(): Backoff {
  return (globalForLyrics.__timbreLrclibBackoff ??= createBackoff({
    defaultSeconds: 30,
    maxSeconds: 600,
  }));
}

class LrclibBusy extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("LRCLIB is rate limiting this deployment.");
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function busy(seconds: number, alternatives: boolean): Response {
  return Response.json(
    {
      ...(alternatives ? { alternatives: [] } : { lyrics: null }),
      busy: true,
      error: "Lyrics are busy. Try again shortly.",
    },
    { status: 503, headers: { "Retry-After": String(seconds), "cache-control": "no-store" } },
  );
}

interface LrcLibTrack {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

function parseLrc(body: string): { at: number; text: string }[] {
  const lines: { at: number; text: string }[] = [];

  for (const raw of body.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (stamps.length === 0) continue;

    const text = raw.replace(/\[[^\]]*\]/g, "").trim();

    for (const [, minutes, seconds, fraction] of stamps) {
      const partial = fraction ? Number(fraction) / (fraction.length === 3 ? 1000 : 100) : 0;
      lines.push({ at: Number(minutes) * 60 + Number(seconds) + partial, text });
    }
  }

  return lines.sort((a, b) => a.at - b.at);
}

async function lrclib(path: string, params: Record<string, string | undefined> = {}) {
  const url = new URL(path, "https://lrclib.net/api/");
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    headers: { "user-agent": "Timbre (https://github.com/bishop076/timbre)" },
    signal: AbortSignal.timeout(6_000),
  });

  const retryAfter = response.headers.get("retry-after");
  if (isBackoffSignal(response.status, retryAfter)) {
    throw new LrclibBusy(lrclibBackoff().trip(retryAfter));
  }
  return response;
}

/**
 * LRCLIB answering 404 is an answer: it holds nothing matching that track. Every other refusal
 * is the service failing, and both used to flatten into the same `null` and `[]` — so a 500, a
 * 502, or a gateway's HTML left this route as `{ lyrics: null }` at 200, which `readAnswer`
 * maps to `none` and the panel states as "no lyrics for this song". The `catch` below has
 * always turned a *thrown* failure into an honest 502; a non-ok response never reached it.
 */
class LrclibUnavailable extends Error {
  constructor(status: number) {
    super(`LRCLIB answered ${status}.`);
  }
}

function answeredOrFail(response: Response): Response {
  if (!response.ok && response.status !== 404) throw new LrclibUnavailable(response.status);
  return response;
}

async function lookup(path: string, params?: Record<string, string | undefined>) {
  const response = answeredOrFail(await lrclib(path, params));
  if (!response.ok) return null;
  const body = (await response.json()) as unknown;
  return body && typeof body === "object" ? (body as LrcLibTrack) : null;
}

/**
 * LRCLIB's `albumName` is not always an album. Some rows carry the literal four-letter string
 * `"undefined"` — a JavaScript value stringified somewhere upstream of us — and `?? null` only
 * catches the absent case, so that word went straight into the Other-versions line and rendered
 * between the artist and the duration. Empty and whitespace-only names are the same kind of
 * non-answer, and the line already drops nulls.
 */
function albumOf(name: string | undefined): string | null {
  const trimmed = name?.trim();
  return !trimmed || trimmed === "undefined" || trimmed === "null" ? null : trimmed;
}

async function search(track: string, artist: string): Promise<LrcLibTrack[]> {
  const response = answeredOrFail(
    await lrclib("search", { track_name: track, artist_name: artist }),
  );
  return response.ok ? ((await response.json()) as LrcLibTrack[]) : [];
}

async function bestMatch(track: string, artist: string, album?: string, duration?: number) {
  const exact = await lookup("get", {
    track_name: track,
    artist_name: artist,
    album_name: album,
    duration: duration?.toString(),
  });
  if (exact) return exact;

  const results = await search(track, artist);
  return results.find((item) => item.syncedLyrics) ?? results[0] ?? null;
}

const LOOKUP_FAILED = "LRCLIB did not answer.";

export const GET = queryRoute(
  z.object({
    title: queryText(300),
    artist: queryText(300),
    album: optionalQueryText(300),
    duration: z.coerce.number().int().positive().max(86_400).optional(),
    id: z.coerce.number().int().positive().optional(),
    alternatives: queryFlag,
  }),
  "A title and artist are required.",
  async ({ title, artist, album, duration, id, alternatives }) => {
    const waiting = lrclibBackoff().remainingSeconds();
    if (waiting > 0) return busy(waiting, alternatives);

    const cleaned = parseTitle(title).base || title;

    try {
      if (alternatives && !id) {
        const results = await search(cleaned, artist);
        return Response.json({
          alternatives: results.slice(0, 20).map((item) => ({
            id: item.id,
            trackName: item.trackName,
            artistName: item.artistName,
            albumName: albumOf(item.albumName),
            duration: item.duration ?? null,
            synced: Boolean(item.syncedLyrics),
          })),
        });
      }

      const track = id
        ? await lookup(`get/${id}`)
        : await bestMatch(cleaned, artist, album, duration);
      if (!track) return Response.json({ lyrics: null });

      return json(
        {
          lyrics: {
            instrumental: track.instrumental,
            synced: track.syncedLyrics ? parseLrc(track.syncedLyrics) : null,
            plain: track.plainLyrics,
            matchedTitle: track.trackName,
            matchedArtist: track.artistName,
            // LRCLIB's id for the track that answered, not the `id` the query asked with — which
            // is absent on every automatic match, so `lyrics.id` arrived `undefined` and the tick
            // in Other versions (`lyrics.id === option.id`) could never be true for the version
            // actually playing. Asked for a specific id, the two are the same number anyway.
            id: track.id,
          },
        },
        CACHE_CONTROL_DAY,
      );
    } catch (error) {
      if (error instanceof LrclibBusy) return busy(error.retryAfterSeconds, alternatives);

      // `{ lyrics: null }` at 200 is the answer for "this song has no lyrics", and returning
      // it here asserted that about every LRCLIB timeout, DNS failure and unparseable body —
      // `readAnswer` maps a 200 with a null body to `none` and a 502 to `failed`, so the panel
      // stated as fact something the request never established. On the `alternatives` path it
      // was worse: a body with no `alternatives` key reads as an empty list, so the panel also
      // claimed to have seen every alternative there is. A failure says it failed.
      log("warn", "lyrics_upstream_failed", { ...describeError(error), alternatives });
      return Response.json(alternatives ? { error: LOOKUP_FAILED } : { lyrics: null, error: LOOKUP_FAILED }, {
        status: 502,
        headers: { "cache-control": "no-store" },
      });
    }
  },
);
