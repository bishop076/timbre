/**
 * Artist names in a URL.
 *
 * `encodeURIComponent` is correct and ugly: every space becomes `%20`, so
 * "Ariana Grande" reads as `/artist/Ariana%20Grande` in the address bar and in
 * anything anyone pastes. A slug is the same information without the noise.
 *
 * **Lossy on purpose.** `AC/DC` and `Tyler, The Creator` both flatten, and there
 * is no way back to the original punctuation. That is fine here because the
 * slug is never treated as the artist's name — it is a *search term*, handed to
 * the same fuzzy lookup the search box uses, and the name that gets displayed
 * comes from whatever the catalogue answers with. `jay-z` finds JAY-Z.
 */

/** `Tyler, The Creator` → `tyler-the-creator`. */
export function toArtistSlug(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/\p{M}/gu, "") // strip the marks NFKD leaves behind
      .replace(/[’'`´]/g, "")
      .replace(/&/g, " and ")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || encodeURIComponent(name)
  );
}

/** `tyler-the-creator` → `tyler the creator`, ready to search with. */
export function fromArtistSlug(slug: string): string {
  return decodeURIComponent(slug).replace(/-+/g, " ").trim();
}

/**
 * A readable name for a slug, used only until the catalogue answers with the
 * real one. Title case beats showing `ariana grande` in a heading for the
 * moment before the lookup returns.
 */
export function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}
