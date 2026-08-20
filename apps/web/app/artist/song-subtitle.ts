import { normalizeLoose } from "@timbre/core";

/** How catalogues label a release holding one track. Part of the packaging, not the name. */
const RELEASE_KIND = /\s*[-–—]\s*(single|ep)\s*$/i;

/**
 * Whether naming the album tells the reader anything the title has not.
 *
 * **A single's album is its own title.** "This Was Your Song" sits on "This Was Your Song -
 * Single", and Apple often drops even that suffix, so the line under the title repeated it
 * word for word. Reported as the artist page spamming the title — and most of a modern
 * discography is singles, so it was nearly every row.
 */
export function albumAddsSomething(album: string | null, title: string): boolean {
  if (!album) return false;
  return normalizeLoose(album.replace(RELEASE_KIND, "")) !== normalizeLoose(title);
}
