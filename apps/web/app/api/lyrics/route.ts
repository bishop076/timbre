import { parseTitle } from "@timbre/core";
import { z } from "zod";

import { CACHE_CONTROL_DAY, json, queryRoute } from "@/lib/api";
import { optionalQueryText, queryFlag, queryText } from "@/lib/query-text";
import { createBackoff, isBackoffSignal, type Backoff } from "@/lib/upstream-backoff";

export const revalidate = 86_400;

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

async function lookup(path: string, params?: Record<string, string | undefined>) {
  const response = await lrclib(path, params);
  if (!response.ok) return null;
  const body = (await response.json()) as unknown;
  return body && typeof body === "object" ? (body as LrcLibTrack) : null;
}

async function search(track: string, artist: string): Promise<LrcLibTrack[]> {
  const response = await lrclib("search", { track_name: track, artist_name: artist });
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
            albumName: item.albumName ?? null,
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
            id,
          },
        },
        CACHE_CONTROL_DAY,
      );
    } catch (error) {
      if (error instanceof LrclibBusy) return busy(error.retryAfterSeconds, alternatives);
      return Response.json({ lyrics: null });
    }
  },
);
