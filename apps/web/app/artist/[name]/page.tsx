import { mergeTracks, searchAll } from "@timbre/providers";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { fromArtistSlug, titleCase } from "@/app/artist-slug";

import { creditNames } from "../credits";
import { getProviderRuntime } from "@/lib/providers";
import { deezerIdFrom, fetchDiscography, findArtist } from "@/lib/discography";

import { ArtistAbout } from "../artist-about";
import { ArtistView } from "../artist-view";

/**
 * An artist page assembled from keyless answers: Deezer knows who they are, the search
 * merger knows which recordings can be played, and Wikipedia — reached through Wikidata or
 * MusicBrainz — says who they are in prose. Keyed by name, not a source's artist id, which
 * would bind the route to whichever service supplied it — at the cost of precision on
 * artists who share a name.
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

  /* Only rows crediting the artist — see `creditNames` for why whole names, not substrings. */
  const theirs = songs.filter((song) =>
    song.artists.some((credited) => creditNames(name, credited)),
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
      /* Streamed rather than awaited, and handed in rendered because `ArtistView` is a client
       * component — the pattern `explore/page.tsx` uses. Only with a Deezer profile: the
       * biography is found from it, and a name alone picks namesakes. */
      about={
        artist ? (
          <Suspense key="about" fallback={null}>
            <ArtistAbout
              name={artist.name}
              deezerId={deezerIdFrom(artist.url)}
              releaseTitles={releases.map((release) => release.title)}
            />
          </Suspense>
        ) : null
      }
    />
  );
}
