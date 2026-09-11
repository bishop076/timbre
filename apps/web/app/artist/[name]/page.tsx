import { mergeTracks, searchAll } from "@timbre/providers";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { fromArtistSlug, titleCase } from "@/app/artist-slug";
import { deezerIdFrom, fetchDiscography, findArtist } from "@/lib/discography";
import { getProviderRuntime } from "@/lib/providers";

import { ArtistAbout } from "../artist-about";
import { ArtistView } from "../artist-view";
import { creditNames } from "../credits";

export const revalidate = 3600;

type Props = { params: Promise<{ name: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `${titleCase(fromArtistSlug((await params).name))} — Timbre` };
}

export default async function ArtistPage({ params }: Props) {
  const name = fromArtistSlug((await params).name);
  if (!name.trim()) notFound();

  const { limiter } = getProviderRuntime();
  const [artist, results] = await Promise.all([
    findArtist(name).catch(() => null),
    searchAll({ limiter }, name, 40).catch(() => ({ tracks: [], failures: [] })),
  ]);

  const none = { releases: [], related: [] };
  const { releases, related } = artist ? await fetchDiscography(artist.url).catch(() => none) : none;

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
