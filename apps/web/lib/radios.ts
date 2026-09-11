import "server-only";

import { normalizeLoose } from "@timbre/core";

import { deezerList } from "./deezer";

export interface Radio {
  id: number;
  title: string;
  genre: string;
  genreId: number;
  imageUrl: string | null;
}

interface RadioGenre {
  id: number;
  title: string;
  radios?: { id: number; title: string; picture_medium?: string; picture_big?: string }[];
}

const MAX_TITLE = 22;

export async function fetchRadios(): Promise<Radio[]> {
  const seen = new Set<string>();
  const radios: Radio[] = [];

  for (const genre of await deezerList<RadioGenre>("/radio/genres")) {
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

export async function genreOfStation(id: number): Promise<{ id: number; name: string } | null> {
  const genres = await deezerList<RadioGenre>("/radio/genres");
  const group = genres.find((genre) => genre.radios?.some((radio) => radio.id === id));
  return group && group.id > 0 ? { id: group.id, name: group.title } : null;
}
