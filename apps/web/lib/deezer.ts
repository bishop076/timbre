import "server-only";

import { z } from "zod";

import { log, scrub } from "./log.ts";

/**
 * Deezer's track rows, parsed rather than asserted.
 *
 * This was an `interface`, which is a promise about somebody else's server, and every read
 * below reached it through an `as`. One row of `null` in `/chart/0` — or in a playlist, or in
 * a station's `/radio/<id>/tracks` — reached `toTrack` in `./discover` and threw
 * `Cannot read properties of null (reading 'id')`, which is `/explore`, `/collection/...` and
 * `/api/genre-feed` all breaking on a row nobody looks at. The same shape one level up, a
 * `data` that is an object rather than a list, threw `list is not iterable` before any row
 * was read at all.
 *
 * Only `id` and `title` are required, because they are the two fields every caller builds an
 * entry around. Everything else is `nullish`: a Deezer track legitimately has no ISRC, no rank
 * and no album.
 */
export const rawTrackSchema = z.object({
  id: z.number(),
  title: z.string(),
  duration: z.number().nullish(),
  isrc: z.string().nullish(),
  rank: z.number().nullish(),
  position: z.number().nullish(),
  link: z.string().nullish(),
  artist: z.object({ name: z.string().nullish() }).nullish(),
  album: z
    .object({
      title: z.string().nullish(),
      cover_medium: z.string().nullish(),
      cover_big: z.string().nullish(),
    })
    .nullish(),
});

export type RawTrack = z.output<typeof rawTrackSchema>;

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
 *
 * A caller that also has to *act* on the difference passes a probe — `FeedProbe` in
 * `./genre-feed`, taken here by shape rather than by import so the forgiving read stays below
 * the module built on top of it. Everything about a caller that passes none is unchanged.
 */
export async function deezer<T>(
  path: string,
  revalidateSeconds = 86_400,
  probe?: { failed: boolean },
): Promise<T | null> {
  try {
    return await deezerOrFail<T>(path, revalidateSeconds);
  } catch (cause) {
    if (cause instanceof DeezerUnavailable) {
      log("warn", "deezer_unavailable", { path, message: scrub(cause.message) });
      if (probe) probe.failed = true;
      return null;
    }
    throw cause;
  }
}

/**
 * A Deezer list of rows, wherever one appears — at the top of a body under `data`, or nested
 * under `tracks`, `albums`, `artists`, `playlists`.
 *
 * One parser, not one per caller: `lib/` reads eleven Deezer lists and every one of them used
 * a TypeScript `interface` and a cast, so a row Deezer sent that is not the row the interface
 * described reached the mapper untouched. Rows that fail are dropped rather than taken down
 * with the answer, the way `/api/lyrics` treats a bad row in a search result — one unreadable
 * album is one album missing, not a discography that failed. A body whose `data` is not a list
 * at all is a different thing, and the two readers below take opposite views of it.
 */
export function deezerRowList<T>(row: z.ZodType<T>) {
  return z.array(z.unknown()).transform((rows) =>
    rows.flatMap((raw) => {
      const parsed = row.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  );
}

/** The same, for the usual Deezer shape: the rows under a `data` key. */
export function deezerRows<T>(row: z.ZodType<T>) {
  return z.object({ data: deezerRowList(row) }).transform((body) => body.data);
}

/**
 * A nested list that is allowed to be missing, or to be something this cannot read.
 *
 * `/chart/<id>` is four independent shelves in one body — tracks, albums, artists, playlists —
 * and reading it as one object meant an `albums.data` Deezer garbled emptied the other three
 * as well. A shelf that cannot be read is an empty shelf; the body it arrived in is still the
 * chart. The strict readers above take the opposite view, and the difference is whether the
 * answer is a shelf or a claim.
 */
export function deezerShelf<T>(row: z.ZodType<T>) {
  return deezerRows(row).nullish().catch(undefined);
}

/** The forgiving list read: a body that is not a list of rows is no rows. */
export async function deezerList<T>(
  path: string,
  row: z.ZodType<T>,
  revalidateSeconds?: number,
  probe?: { failed: boolean },
): Promise<T[]> {
  const parsed = deezerRows(row).safeParse(await deezer<unknown>(path, revalidateSeconds, probe));
  return parsed.success ? parsed.data : [];
}

/**
 * The strict list read: a body that is not a list of rows is Deezer failing.
 *
 * `deezerList` turns any failure into `[]`, which is the right forgiveness for a shelf of
 * related artists and the wrong one for the read that decides whether a thing exists at all —
 * those pages are `force-static`, so a body read as "there is nothing here" is served as one
 * for the rest of the revalidate window. Throwing reaches the segment's `error.tsx`, which is
 * both true and not cached, and reaches `deezerRefusal` on the routes.
 */
export async function deezerListOrFail<T>(
  path: string,
  row: z.ZodType<T>,
  revalidateSeconds?: number,
): Promise<T[]> {
  const body = await deezerOrFail<unknown>(path, revalidateSeconds);
  if (body === null) return [];

  const parsed = deezerRows(row).safeParse(body);
  if (!parsed.success) throw new DeezerUnavailable(path, "sent something that is not a list");
  return parsed.data;
}

/**
 * What a route says when a strict read throws: a 502 nothing is allowed to remember.
 *
 * `deezerOrFail` exists so a page can tell an outage from an absence, and the two routes reading
 * through it had no `catch` at all — so Deezer rate limiting this deployment left `/api/artist`
 * and `/api/taste` as a bare 500 with an empty body and no cache directives, from a request that
 * was perfectly well formed. A 500 says Timbre broke; this says Deezer would not answer, which
 * is what happened, and `no-store` keeps the CDN from holding that answer over the outage.
 *
 * Returns `null` for anything that is not a Deezer outage, so a caller rethrows what it cannot
 * explain rather than dressing it up as one.
 */
export function deezerRefusal(error: unknown): Response | null {
  if (!(error instanceof DeezerUnavailable)) return null;

  log("warn", "deezer_route_failed", { reason: error.reason, message: scrub(error.message) });
  return Response.json(
    { error: "Deezer wouldn't answer for this just now. Try again shortly." },
    { status: 502, headers: { "cache-control": "no-store" } },
  );
}

const chartTracks = z.object({ tracks: deezerShelf(rawTrackSchema) });

export async function fetchChartTracks(
  genre: number | string,
  probe?: { failed: boolean },
): Promise<RawTrack[]> {
  const chart = chartTracks.safeParse(await deezer<unknown>(`/chart/${genre}?limit=50`, 3_600, probe));
  return chart.success ? (chart.data.tracks ?? []) : [];
}

export function newestFirst(
  a: { release_date?: string | null },
  b: { release_date?: string | null },
): number {
  return (b.release_date ?? "").localeCompare(a.release_date ?? "");
}
