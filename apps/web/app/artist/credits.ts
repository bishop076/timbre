import { normalizeArtists, normalizeLoose } from "@timbre/core";

export function creditNames(name: string, credited: string): boolean {
  const target = normalizeLoose(name);
  if (!target) return false;
  if (normalizeArtists([credited]).includes(target)) return true;

  // A longer billing of the same act — "Lé Real Music" for "Lé Real" — still counts. But only
  // when the name is more than one word: a lone word is too weak a signal to bill on. "risy"
  // would take in "Risy Morales" and "Risy Boy tv", who are three different artists.
  if (!target.includes(" ")) return false;
  return ` ${normalizeLoose(credited)} `.includes(` ${target} `);
}
