/**
 * Whether a search result is plausibly the song that was asked for.
 *
 * Lives apart from the player so it can be tested: it is the guard that decides whether a
 * fall-through plays another copy of your song or something else entirely.
 */

import type { Song } from "../types";

/** Words that carry meaning, lowercased. Punctuation and case differ constantly between
 * sources and never distinguish two songs. */
export function titleWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1);
}

/**
 * Whether a search result is plausibly the song that was asked for.
 *
 * A search is a *guess* — it returns the best matches for some words, and the best match for
 * words nothing carries is still something. Playing that as the song is how *"I'm laughing,
 * but I just might cry"* became a cat video, and it is a whole class of failure rather than
 * one bad result: any title that is an ordinary sentence will find a confident stranger.
 *
 * Half the seed's words, at least two of them, appearing in the candidate's title or artist.
 * Deliberately loose — `As It Was` must still match `As It Was (Official Video)` and
 * `Wonderwall` must still match `Wonderwall - Remastered`, because those *are* the song and
 * rejecting them would break the fall-through this exists to serve.
 */
export function plausiblySameSong(seed: Song, found: Song): boolean {
  const wanted = titleWords(seed.title);
  if (wanted.length === 0) return true;

  const haystack = new Set(titleWords(`${found.title} ${found.artists.join(" ")}`));
  const hits = wanted.filter((word) => haystack.has(word)).length;

  return hits >= Math.max(2, Math.ceil(wanted.length / 2)) || hits === wanted.length;
}
