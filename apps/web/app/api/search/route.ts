import { mergeTracks, searchAll } from "@timbre/providers";
import { z } from "zod";

import {
  cached,
  json,
  publicFailures,
  queryRoute,
  reportFailures,
  RESPONSE_CACHE_TTL_MS,
  whole,
} from "@/lib/api";
import { getProviderRuntime } from "@/lib/providers";
import { queryText } from "@/lib/query-text";

export const dynamic = "force-dynamic";

/**
 * What a shared cache is allowed to do with a search result — which, until now, was anything
 * it liked. Measured on a production build: `200 OK` with no `cache-control` at all, so the
 * only thing between a CDN and a heuristic freshness lifetime on this body was its own default.
 * `200` is a heuristically cacheable status (RFC 9111 §4.2.2) and the response carries no
 * `etag`, `last-modified` or `expires` either, so there was nothing to bound it with.
 *
 * Two directives, because there are two kinds of answer here and they deserve opposite ones.
 *
 * A whole answer gets `s-maxage=120` — the same window `cached` already holds it for in
 * process, so no cache in front of Timbre ever claims a search is fresher for longer than
 * Timbre does. It is `public` rather than `private` because a search result is not about the
 * reader: there are no accounts, no cookies and no auth, and the in-process cache is already
 * keyed on the query alone. No `stale-while-revalidate`, unlike every other route here: a
 * cover and a discography are stable and expensive, so serving one stale is a kindness, while
 * a merge across five providers changes as they come and go, and handing out a stale one is
 * the very "everyone gets the same gap" failure `whole` exists to prevent.
 *
 * An answer a provider failed to contribute to gets `no-store`. `whole` already refuses to
 * keep that in process — *"a result missing a provider is not the answer to this query"* — and
 * this is the same rule said out loud to the cache in front, which has no way to work it out.
 */
const CACHE_CONTROL_SEARCH = `public, s-maxage=${RESPONSE_CACHE_TTL_MS / 1000}`;

export const GET = queryRoute(
  z.object({ q: queryText(200), limit: z.coerce.number().int().min(1).max(50).default(20) }),
  "A search query is required.",
  async ({ q, limit }) => {
    const body = await cached(
      `search:${limit}:${q.toLowerCase()}`,
      // Deliberately no `signal`: `cached` hands one in-flight promise to every caller waiting
      // on the same query, so one client navigating away would abort the search for all of
      // them. The cost is that an abandoned search runs to completion; the alternative is
      // cancelling someone else's.
      async () => {
        const { tracks, failures, attempted } = await searchAll(getProviderRuntime(), q, limit);
        reportFailures("/api/search", failures);
        return { songs: mergeTracks(tracks), failures: publicFailures(failures), attempted };
      },
      // A result missing a provider is not the answer to this query, only the best that could
      // be had at that moment; caching it served everyone the same gap for the full two
      // minutes, including after the provider came back.
      whole,
    );
    return json(body, whole(body) ? CACHE_CONTROL_SEARCH : "no-store");
  },
  { issues: true },
);
