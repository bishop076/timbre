import { normalizeLoose } from "@timbre/core";

const RELEASE_KIND = /\s*[-–—]\s*(single|ep)\s*$/i;

export function albumAddsSomething(album: string | null, title: string): boolean {
  if (!album) return false;
  return normalizeLoose(album.replace(RELEASE_KIND, "")) !== normalizeLoose(title);
}
