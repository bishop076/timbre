import "server-only";

import { normalizeLoose } from "@timbre/core";

import { deezer } from "./deezer";

export interface Radio {
  id: number;
  title: string;
  genre: string;
  genreId: number;
  imageUrl: string | null;
}

interface RawRadio {
  id: number;
  title: string;
  picture_medium?: string;
  picture_big?: string;
}

const MAX_TITLE = 22;

export async function fetchRadios(): Promise<Radio[]> {
  const data = await deezer<{ data?: { id: number; title: string; radios?: RawRadio[] }[] }>(
    "/radio/genres",
    86_400,
  );

  const seen = new Set<string>();
  const radios: Radio[] = [];

  for (const genre of data?.data ?? []) {
    for (const raw of genre.radios ?? []) {
      const title = raw.title?.trim();
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
