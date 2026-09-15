import type { Song } from "./types";

/**
 * A genre's songs, or `null` because nobody could say.
 *
 * `/api/genre-feed` answers **503** when Deezer would not answer for the genre, and 200 with an
 * empty list when the genre really is empty — telling those apart is the whole point of the
 * probe `lib/genre-feed.ts` threads through its reads. The shelf read it back as
 * `response.ok ? json : null` and then `?? []`, so both arrived as "no songs", and a shelf with
 * no songs removes itself: a Deezer outage rendered as an Explore page on which the For-you
 * shelves had simply never existed, with nothing anywhere saying otherwise.
 *
 * It is a module of its own because that is what makes it testable — `explore-for-you.tsx`
 * imports `next/link`, which `node --test` cannot resolve, so nothing inside it can be reached
 * by the suite.
 */
export async function fetchGenreShelf(id: number, signal: AbortSignal): Promise<Song[] | null> {
  const response = await fetch(`/api/genre-feed?id=${id}`, { signal });
  if (!response.ok) return null;
  const body = (await response.json()) as { songs?: Song[] } | null;
  return body?.songs ?? [];
}
