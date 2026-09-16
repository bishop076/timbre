import "server-only";

import { normalizeLoose } from "@timbre/core";
import { z } from "zod";

import { deezerList, deezerRowList } from "./deezer";

export interface Radio {
  id: number;
  title: string;
  genre: string;
  genreId: number;
  imageUrl: string | null;
}

/**
 * Deezer's radio genres, parsed rather than asserted.
 *
 * `/explore` is `force-static`, and this read was an `interface` and a cast: one row of `null`
 * in `/radio/genres` threw `Cannot read properties of null (reading 'radios')` and a `data`
 * that is not a list threw `(intermediate value) is not iterable`, both of them before the
 * loop had looked at a single station. A genre row Deezer sent that this cannot read is now
 * one rail missing from the page, not the page.
 */
const radioSchema = z.object({
  id: z.number(),
  title: z.string(),
  picture_medium: z.string().nullish(),
  picture_big: z.string().nullish(),
});

const radioGenreSchema = z.object({
  id: z.number(),
  title: z.string(),
  radios: deezerRowList(radioSchema).nullish().catch(undefined),
});

const MAX_TITLE = 22;

export async function fetchRadios(): Promise<Radio[]> {
  const seen = new Set<string>();
  const radios: Radio[] = [];

  for (const genre of await deezerList("/radio/genres", radioGenreSchema)) {
    for (const raw of genre.radios ?? []) {
      const title = raw.title.trim();
      if (!title || title.length > MAX_TITLE) continue;

      const key = normalizeLoose(title);
      if (!key || seen.has(key)) continue;
      seen.add(key);

      radios.push({
        id: raw.id,
        title,
        genre: genre.title,
        genreId: genre.id,
        imageUrl: raw.picture_big ?? raw.picture_medium ?? null,
      });
    }
  }

  return radios;
}

export async function genreOfStation(id: number): Promise<{ id: number; name: string } | null> {
  const genres = await deezerList("/radio/genres", radioGenreSchema);
  const group = genres.find((genre) => genre.radios?.some((radio) => radio.id === id));
  return group && group.id > 0 ? { id: group.id, name: group.title } : null;
}
