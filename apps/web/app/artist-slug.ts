// Artist names in a URL, without `encodeURIComponent`'s `%20` noise. Lossy on purpose —
// `AC/DC` and `Tyler, The Creator` both flatten with no way back to the punctuation. Safe
// because a slug is never the artist's name: it is a search term for the same fuzzy lookup
// the search box uses, and the displayed name comes from what the catalogue answers with.

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

/** A readable stand-in name, used only until the catalogue answers with the real one. */
export function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}
