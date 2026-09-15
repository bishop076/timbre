export function toArtistSlug(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/[’'`´]/g, "")
      .replace(/&/g, " and ")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || encodeURIComponent(name)
  );
}

export function fromArtistSlug(slug: string): string {
  // Next hands this segment over already decoded, so a name that legitimately carries a
  // percent — or a hand-typed /artist/100%25 — reaches `decodeURIComponent` as a lone `%`
  // and it throws `URIError`. `generateMetadata` calls this too, and that runs outside the
  // route's error boundary, so the throw became a 500 rather than the empty state.
  let decoded = slug;
  try {
    decoded = decodeURIComponent(slug);
  } catch {}
  return decoded.replace(/-+/g, " ").trim();
}

export function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

/**
 * Whether a name a source answered with is the name that was asked for.
 *
 * `findArtist` is a best guess, not a lookup: it scores 25 Deezer hits and its reducer seeds
 * with `results[0]`, so as long as Deezer returned anything at all it returns somebody. Asking
 * it for the SoundCloud uploader "Pump Glock" answers Black Pumas, and "Praise Stones" answers
 * Stoned in Paradise. The search facet already refused a non-exact hit; the now-playing panel's
 * "About the artist" card did not, and drew the wrong band's photograph, follower count and
 * link under the name of whoever actually uploaded the track.
 *
 * Compared as slugs so the guard is as forgiving as the URL is — "The Marías" and "the marias"
 * are the same artist, "Pump Glock" and "Black Pumas" are not.
 */
export function isSameArtist(asked: string, answered: string): boolean {
  const wanted = toArtistSlug(asked.trim());
  return wanted !== "" && wanted === toArtistSlug(answered.trim());
}
