import "server-only";

import { log, scrub } from "./log.ts";

export interface RawTrack {
  id: number;
  title: string;
  duration?: number;
  isrc?: string;
  rank?: number;
  position?: number;
  link?: string;
  artist?: { name?: string };
  album?: { title?: string; cover_medium?: string; cover_big?: string };
}

// Deezer localises names — artists, genres, editorial titles — to whatever country it
// geolocates the caller to, and it reads that from the request IP alone: `country=US` is
// ignored, only `Accept-Language` moves it. Without this a server in Tokyo renders
// "Fresh in ダンス" and bills Tame Impala as テーム・インパラ, which also breaks the
// cross-provider merge in merge.ts, since that keys on the artist name.
export const DEEZER_HEADERS = { "accept-language": "en-US,en;q=0.9" };

/** Deezer could not answer. Distinct from Deezer answering "there is no such thing". */
export class DeezerUnavailable extends Error {
  readonly reason: string;

  constructor(path: string, reason: string, options: { cause?: unknown } = {}) {
    super(`Deezer ${reason} for ${path}.`, { cause: options.cause });
    this.name = "DeezerUnavailable";
    this.reason = reason;
  }
}

// Deezer answers 200 to everything and puts the verdict in the body, so the HTTP status says
// almost nothing and these codes say all of it. 800 is the only one that means the thing
// genuinely is not there; 4 and 700 are Deezer having a bad minute. The rest — a malformed
// path, a bad parameter — are our bug and deterministic, so they read as absent: retrying
// cannot change them and caching that costs nothing.
const QUOTA = 4;
const SERVICE_BUSY = 700;

/**
 * The strict read: `null` only when Deezer said there is no such thing, and a throw when it
 * could not say. Use it wherever the answer decides between rendering and `notFound()` — a
 * page cached under `force-static` will keep whichever it got, and "not found" is the wrong
 * thing to keep for an hour because a request timed out. `deezer` is the forgiving version.
 */
export async function deezerOrFail<T>(path: string, revalidateSeconds = 86_400): Promise<T | null> {
  let response: Response;
  try {
    response = await fetch(`https://api.deezer.com${path}`, {
      signal: AbortSignal.timeout(6_000),
      headers: DEEZER_HEADERS,
      next: { revalidate: revalidateSeconds },
    });
  } catch (cause) {
    const timedOut = cause instanceof DOMException && cause.name === "TimeoutError";
    throw new DeezerUnavailable(path, timedOut ? "timed out" : "was unreachable", { cause });
  }

  if (!response.ok) throw new DeezerUnavailable(path, `returned ${response.status}`);

  let body: (T & { error?: { code?: number } }) | null;
  try {
    body = (await response.json()) as T & { error?: { code?: number } };
  } catch (cause) {
    throw new DeezerUnavailable(path, "returned an unreadable body", { cause });
  }

  const error = body && typeof body === "object" ? body.error : undefined;
  if (!error) return body;
  if (error.code === QUOTA) throw new DeezerUnavailable(path, "is rate limiting this deployment");
  if (error.code === SERVICE_BUSY) throw new DeezerUnavailable(path, "reported itself busy");
  return null;
}

/**
 * The forgiving read: any failure reads as "no such thing".
 *
 * It stays forgiving, but it no longer stays quiet. A quota refusal — Deezer error code 4 —
 * arrives here as `DeezerUnavailable` and left as `null`, which `deezerList` turns into `[]`
 * and a genre page renders as "nothing fresh in this genre" under fifteen minutes of
 * `s-maxage`. Nothing anywhere said the deployment had been rate limited. The caller still
 * gets its `null`; the operator now gets a line saying why.
 */
export async function deezer<T>(path: string, revalidateSeconds = 86_400): Promise<T | null> {
  try {
    return await deezerOrFail<T>(path, revalidateSeconds);
  } catch (cause) {
    if (cause instanceof DeezerUnavailable) {
      log("warn", "deezer_unavailable", { path, message: scrub(cause.message) });
      return null;
    }
    throw cause;
  }
}

export async function deezerList<T>(path: string, revalidateSeconds?: number): Promise<T[]> {
  return (await deezer<{ data?: T[] }>(path, revalidateSeconds))?.data ?? [];
}

export async function fetchChartTracks(genre: number | string): Promise<RawTrack[]> {
  const chart = await deezer<{ tracks?: { data?: RawTrack[] } }>(`/chart/${genre}?limit=50`, 3_600);
  return chart?.tracks?.data ?? [];
}

export function newestFirst(a: { release_date?: string }, b: { release_date?: string }): number {
  return (b.release_date ?? "").localeCompare(a.release_date ?? "");
}
