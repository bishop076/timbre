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
