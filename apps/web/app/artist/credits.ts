import { normalizeArtists, normalizeLoose } from "@timbre/core";

export function creditNames(name: string, credited: string): boolean {
  const target = normalizeLoose(name);
  if (!target) return false;
  if (normalizeArtists([credited]).includes(target)) return true;
  return ` ${normalizeLoose(credited)} `.includes(` ${target} `);
}
