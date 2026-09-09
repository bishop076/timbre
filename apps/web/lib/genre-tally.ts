import { normalizeLoose } from "@timbre/core";

// Which genres someone listens to, from the history this browser keeps. Not a taste model —
// see docs/RECOMMENDATIONS.md — only a count: each recent play votes for its artist's genre,
// newer plays louder. Kept apart from both callers so the arithmetic can be tested without a
// browser or a network. No `server-only`: the route and the browser both use it.

/** How an artist is looked up in the browser's cache. Loose, so "Beyoncé" and "Beyonce" are one. */
export function artistKey(name: string): string {
  return normalizeLoose(name);
}

/**
 * An artist's genre: whichever Deezer tags most of their releases with. Deezer tags albums,
 * never artists, so a majority is the closest thing to "what they make". `0` is Deezer's
 * "All" and negative ids are untagged, so neither votes. A tie goes to the id seen first,
 * and callers pass releases newest first — an artist who changed direction is filed under
 * where they are now.
 */
export function dominantGenre(genreIds: readonly (number | null | undefined)[]): number | null {
  const counts = new Map<number, number>();
  for (const id of genreIds) {
    if (typeof id !== "number" || id <= 0) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  let best: number | null = null;
  let bestCount = 0;
  // A Map iterates in insertion order, which is first-seen order — the tie-break above.
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
  /** Relative, not a count — only the order and the shares mean anything. */
  weight: number;
  /** Who put it there, most recent first. Capped: it is a caption, not a list. */
  artists: string[];
}

/**
 * Each play is worth `decay` of the one after it, so the last few songs outweigh last month.
 * 0.92 halves a play's say about eight plays back — a mood changes Explore within an
 * evening, and one stray song does not.
 */
const DECAY = 0.92;

/** How many artists a genre carries for its caption. */
const NAMED = 3;

/** Genres by weight, heaviest first. `played` is newest first, as the history stores it. */
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

/** Names joined as prose — "A", "A and B", "A, B and C" — for the captions that credit them. */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
