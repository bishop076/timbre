import { normalizeLoose } from "@timbre/core";

export const artistKey = normalizeLoose;

export function dominantGenre(genreIds: readonly (number | null | undefined)[]): number | null {
  const counts = new Map<number, number>();
  for (const id of genreIds) {
    if (typeof id === "number" && id > 0) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  let best: number | null = null;
  for (const [id, count] of counts) {
    if (best === null || count > counts.get(best)!) best = id;
  }
  return best;
}

export interface GenreWeight {
  id: number;
  weight: number;
  artists: string[];
}

export function tallyGenres(
  played: readonly { artist: string | undefined }[],
  genreOf: (artist: string) => number | null,
): GenreWeight[] {
  const genres = new Map<number, GenreWeight>();

  played.forEach(({ artist }, index) => {
    const id = artist ? genreOf(artist) : null;
    if (!artist || id === null) return;

    const genre: GenreWeight = genres.get(id) ?? { id, weight: 0, artists: [] };
    genres.set(id, genre);
    genre.weight += 0.92 ** index;

    const key = artistKey(artist);
    if (genre.artists.length < 3 && !genre.artists.some((name) => artistKey(name) === key)) {
      genre.artists.push(artist);
    }
  });

  return [...genres.values()].sort((a, b) => b.weight - a.weight);
}

export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
