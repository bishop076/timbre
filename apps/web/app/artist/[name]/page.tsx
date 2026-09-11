import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { fromArtistSlug, titleCase } from "@/app/artist-slug";
import { deezerIdFrom, fetchDiscography, findArtist } from "@/lib/discography";

import { ArtistAbout } from "../artist-about";
import { ArtistView } from "../artist-view";

export const revalidate = 3600;
export const dynamic = "force-static";

type Props = { params: Promise<{ name: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `${titleCase(fromArtistSlug((await params).name))} — Timbre` };
}

export default async function ArtistPage({ params }: Props) {
  const name = fromArtistSlug((await params).name);
  if (!name.trim()) notFound();

  const artist = await findArtist(name);
  const none = { releases: [], related: [] };
  const { releases, related } = artist ? await fetchDiscography(artist.url).catch(() => none) : none;

  return (
    <ArtistView
      query={name}
      name={artist?.name ?? titleCase(name)}
      imageUrl={artist?.imageUrl ?? null}
      followers={artist?.followers ?? null}
      sourceUrl={artist?.url ?? null}
      sourceName={artist?.source ?? null}
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
