import "server-only";

import { normalizeLoose } from "@timbre/core";

import { deezer } from "./deezer";

/*
 * Explore's mood and decade rows, from Deezer's `/radio/genres` taxonomy rather than a
 * written list: keyless stations with artwork and a tracklist each, following the locale.
 */

export interface Radio {
  id: number;
  title: string;
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
 * The longest a title can be and still be a category — Deezer's list mixes campaign
 * entries in with evergreen stations. Cut on length, never a blocklist of names: a
 * category is a word or three, a promotion a sentence, and that holds in every locale.
 */
const MAX_TITLE = 22;

/** Deezer's station categories, filtered to the ones that work as pills. */
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

      // Deduplicated across the taxonomy, not per genre — Deezer lists "Hits" and
      // "Techno" under several, and a repeated pill reads as a bug.
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
