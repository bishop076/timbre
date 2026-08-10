import "server-only";

import { normalizeLoose } from "@timbre/core";

import { deezer } from "./deezer";

/**
 * Deezer's own categories, in place of a written list.
 *
 * **Explore's mood and decade rows used to be strings in the repository** —
 * "Workout", "Sleep", "1980s" — chosen by me and identical for every visitor in
 * every country. They worked, because each one was only a search term, but the
 * vocabulary itself was invented and could not change without a deploy.
 *
 * `/radio/genres` replaces it wholesale. Deezer publishes a two-level taxonomy,
 * keyless: nineteen genres, each holding its own stations — "Cosy Fireplace",
 * "Sad Songs", "Roadtrip", "The '80s", "Happy Hour", "Focus". Moods, activities
 * and decades, named by the people who own the catalogue, with artwork and a
 * tracklist behind each one. It follows the locale, and it changes when they
 * change it rather than when I do.
 *
 * Alternatives were checked and rejected: AcousticBrainz needs a MusicBrainz id
 * per *recording* and stopped collecting data in 2022; MusicBrainz's genre list
 * carries no artwork and no tracks; Mubert and the metadata services want an
 * API key. None of them publishes a browsable category list keyless.
 */

export interface Radio {
  id: number;
  title: string;
  /** The genre it was published under — the row it belongs in. */
  genre: string;
  imageUrl: string | null;
}

interface RawRadio {
  id: number;
  title: string;
  picture_medium?: string;
  picture_big?: string;
}

/**
 * The longest a title can be and still be a category.
 *
 * Deezer's list mixes evergreen stations in with festival and campaign entries —
 * "75 YEARS TO THE BEAT OF ERA-DEFINING MUSIC 1940", "Filtr URBAN STYLERS:
 * HIPHOP & RNB Switzerland". They are perfectly real radios and terrible pills.
 *
 * The cut is on **length**, not on a list of names, and that distinction is the
 * whole point of this file: a blocklist would be a hardcoded vocabulary wearing
 * a different hat, and would be wrong the moment Deezer ran a new campaign. A
 * category is a word or three; a promotion is a sentence. That holds in every
 * locale without knowing any of them.
 */
const MAX_TITLE = 22;

export async function fetchRadios(): Promise<Radio[]> {
  const data = await deezer<{ data?: { title: string; radios?: RawRadio[] }[] }>(
    "/radio/genres",
    // Stations turn over slowly, and this is the page's spine.
    86_400,
  );

  const seen = new Set<string>();
  const radios: Radio[] = [];

  for (const genre of data?.data ?? []) {
    for (const raw of genre.radios ?? []) {
      const title = raw.title?.trim();
      if (!title || title.length > MAX_TITLE) continue;

      /*
       * Deduplicated across the whole taxonomy, not within a genre.
       *
       * Deezer lists "Hits", "Indie", "Techno" and "Disco" under more than one
       * genre, and a row offering the same word twice reads as a rendering bug
       * rather than as two stations that happen to share a name.
       */
      const key = normalizeLoose(title);
      if (!key || seen.has(key)) continue;
      seen.add(key);

      radios.push({
        id: raw.id,
        title,
        genre: genre.title,
        imageUrl: raw.picture_big ?? raw.picture_medium ?? null,
      });
    }
  }

  return radios;
}
