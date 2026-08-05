import { normalizeLoose } from "@timbre/core";
import { mergeTracks, searchAll } from "@timbre/providers";
import type { Metadata } from "next";

import { fromArtistSlug, titleCase } from "@/app/artist-slug";
import { getProviderRuntime } from "@/lib/providers";
import { fetchDiscography, findArtist } from "@/lib/discography";

import { ArtistView } from "../artist-view";

/**
 * An artist, as Timbre sees them.
 *
 * **Timbre's own page, assembled from other people's catalogues.** Nobody
 * publishes "the artist page" for free, so this is built from two keyless
 * answers: Deezer knows who they are and what they look like, and the search
 * merger knows which of their recordings can actually be played. Neither source
 * could render this page alone.
 *
 * Keyed by name rather than by a source's artist id, deliberately. An id would
 * bind the route to whichever service supplied it, and the whole point is that
 * no single service owns the page — a name is the one identifier every source
 * agrees on. It costs precision on artists who share a name, which is the
 * honest trade for not picking a favourite service.
 *
 * There is no biography, for the reason `ArtistCard` gives: no keyless source
 * publishes one, and inventing prose about a real musician is a fabrication
 * rather than a design choice.
 */

export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ name: string }>;
}): Promise<Metadata> {
  const name = titleCase(fromArtistSlug((await params).name));
  return { title: `${name} — Timbre` };
}

export default async function ArtistPage({ params }: { params: Promise<{ name: string }> }) {
  // The slug is a search term, not a name — the catalogue supplies the real
  // spelling, and `titleCase` only covers the moment before it answers.
  const name = fromArtistSlug((await params).name);
  const { limiter } = getProviderRuntime();
  const ctx = { limiter };

  // Both at once: they are independent lookups against different services, and
  // running them in series would make the page wait for the slower one twice.
  const [artist, results] = await Promise.all([
    findArtist(name).catch(() => null),
    searchAll(ctx, name, 40).catch(() => ({ tracks: [], failures: [] })),
  ]);

  /*
   * The releases, from the artist Deezer just identified.
   *
   * Sequential rather than parallel with the lookup above, because it needs
   * that lookup's answer — the discography is keyed by Deezer's own artist id,
   * which arrives inside the profile URL.
   */
  const { releases, related } = artist
    ? await fetchDiscography(artist.url).catch(() => ({ releases: [], related: [] }))
    : { releases: [], related: [] };

  const songs = mergeTracks(results.tracks);

  /*
   * Searching an artist's name returns their songs *and* everything that merely
   * mentions them — covers, tributes, "in the style of" uploads, and any track
   * whose title contains the word. Keeping only rows where the name appears in
   * the credited artists is a blunt filter, but it is the one that matches what
   * a reader means by "their songs".
   *
   * Compared loosely so that punctuation and case cannot split an artist from
   * themselves — the same normalization the matcher uses to merge sources.
   */
  const target = normalizeLoose(name);
  const theirs = songs.filter((song) =>
    song.artists.some((credited) => {
      const other = normalizeLoose(credited);
      return other === target || other.includes(target) || target.includes(other);
    }),
  );

  return (
    <ArtistView
      name={artist?.name ?? titleCase(name)}
      imageUrl={artist?.imageUrl ?? theirs[0]?.artworkUrl ?? null}
      followers={artist?.followers ?? null}
      sourceUrl={artist?.url ?? null}
      sourceName={artist?.source ?? null}
      // Falls back to the unfiltered list rather than showing nothing: a
      // stricter filter that empties the page is worse than a loose one, and
      // some artists genuinely credit themselves differently per upload.
      songs={theirs.length > 0 ? theirs : songs}
      filtered={theirs.length > 0}
      releases={releases}
      related={related}
    />
  );
}
