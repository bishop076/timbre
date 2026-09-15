import type { Song } from "../types";

/**
 * Spotify's search always answers. Ask it for `qwkjehrqwe` and it returns five songs from the
 * public catalogue — its matcher reaches for anything, and with no account connected there is
 * no market filter to thin them out either. So on a query Timbre's own sources found nothing
 * for, the page said "Nothing found" and then drew five unrelated tracks under "On Spotify",
 * which reads as Timbre having found them.
 *
 * The rule is the weakest one that closes that: a song stays if it shares a word with the
 * query. Any one word of it — "creep radiohead" keeps Creep, and keeps Radiohead's other
 * tracks too, because both are things the reader asked about. A prefix counts, so a query still
 * being typed does not empty the section between keystrokes. What it drops is the case that has
 * nothing in common with what was asked at all.
 */
const SEPARATORS = /[^\p{L}\p{N}]+/gu;
const MARKS = /\p{M}/gu;
const PREFIX = 3;

function words(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(MARKS, "")
    .toLowerCase()
    .split(SEPARATORS)
    .filter(Boolean);
}

function shares(asked: readonly string[], text: string): boolean {
  const found = words(text);
  return asked.some((word) =>
    found.some((other) => other === word || (word.length >= PREFIX && other.startsWith(word))),
  );
}

export function relevantTo(query: string, songs: readonly Song[]): Song[] {
  const asked = words(query);
  // A query that normalises to nothing — punctuation, an emoji — is no basis for dropping
  // anything, so it does not.
  if (asked.length === 0) return [...songs];

  return songs.filter((song) =>
    shares(asked, [song.title, ...song.artists, song.album ?? ""].join(" ")),
  );
}
