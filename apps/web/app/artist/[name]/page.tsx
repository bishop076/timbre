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
  const name = fromArtistSlug((await params).name);

  if (!name.trim()) notFound();

  const { limiter } = getProviderRuntime();
  const ctx = { limiter };

  const [artist, results] = await Promise.all([
    findArtist(name).catch(() => null),
    searchAll(ctx, name, 40).catch(() => ({ tracks: [], failures: [] })),
  ]);

  const { releases, related } = artist
    ? await fetchDiscography(artist.url).catch(() => ({ releases: [], related: [] }))
    : { releases: [], related: [] };

  const songs = mergeTracks(results.tracks);

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
      songs={theirs.length > 0 ? theirs : songs}
      filtered={theirs.length > 0}
      releases={releases}
      related={related}
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
