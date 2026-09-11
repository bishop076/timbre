import { normalizeLoose } from "@timbre/core";

export function artistKey(name: string): string {
  return normalizeLoose(name);
}

export function dominantGenre(genreIds: readonly (number | null | undefined)[]): number | null {
  const counts = new Map<number, number>();
  for (const id of genreIds) {
    if (typeof id !== "number" || id <= 0) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  let best: number | null = null;
  let bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}

export interface GenreWeight {
  id: number;
  weight: number;
  artists: string[];
}

const DECAY = 0.92;

const NAMED = 3;

export function tallyGenres(
  played: readonly { artist: string | undefined }[],
  genreOf: (artist: string) => number | null,
): GenreWeight[] {
  const genres = new Map<number, GenreWeight>();

  played.forEach((entry, index) => {
    if (!entry.artist) return;
    const id = genreOf(entry.artist);
    if (id === null) return;

    const weight = DECAY ** index;
    const current = genres.get(id);
    if (!current) {
      genres.set(id, { id, weight, artists: [entry.artist] });
      return;
    }
    current.weight += weight;
    const key = artistKey(entry.artist);
    if (current.artists.length < NAMED && !current.artists.some((name) => artistKey(name) === key)) {
      current.artists.push(entry.artist);
    }
  });

  return [...genres.values()].sort((a, b) => b.weight - a.weight);
}

export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
