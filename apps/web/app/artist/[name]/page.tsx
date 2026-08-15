import { normalizeLoose } from "@timbre/core";
import { mergeTracks, searchAll } from "@timbre/providers";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { fromArtistSlug, titleCase } from "@/app/artist-slug";
import { getProviderRuntime } from "@/lib/providers";
import { fetchDiscography, findArtist } from "@/lib/discography";

import { ArtistView } from "../artist-view";

/**
 * An artist page assembled from two keyless answers: Deezer knows who they are, the search
 * merger knows which recordings can be played. Keyed by name, not a source's artist id,
 * which would bind the route to whichever service supplied it — at the cost of precision on
 * artists who share a name. No biography: no keyless source publishes one.
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
  // The slug is a search term, not a name: the catalogue supplies the real spelling, and
  // `titleCase` only covers the moment before it answers.
  const name = fromArtistSlug((await params).name);

  // A slug that decodes to nothing is not an artist: `/artist/%20` rendered a complete page
  // for the empty name, so every part behaved and the result looked broken.
  if (!name.trim()) notFound();

  const { limiter } = getProviderRuntime();
  const ctx = { limiter };

  // Both at once: independent lookups against different services.
  const [artist, results] = await Promise.all([
    findArtist(name).catch(() => null),
    searchAll(ctx, name, 40).catch(() => ({ tracks: [], failures: [] })),
  ]);

  // Sequential, because the discography is keyed by Deezer's artist id, which arrives
  // inside the profile URL above.
  const { releases, related } = artist
    ? await fetchDiscography(artist.url).catch(() => ({ releases: [], related: [] }))
    : { releases: [], related: [] };

  const songs = mergeTracks(results.tracks);

  /* Searching a name returns their songs *and* everything that merely mentions them —
   * covers, tributes, "in the style of" uploads — so only rows crediting the name are kept.
   * Compared loosely, so punctuation and case cannot split an artist from themselves. */
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
      // Falls back to the unfiltered list: some artists credit themselves differently per upload.
      songs={theirs.length > 0 ? theirs : songs}
      filtered={theirs.length > 0}
      releases={releases}
      related={related}
    />
  );
}
