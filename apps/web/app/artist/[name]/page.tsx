import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { fromArtistSlug, isSameArtist, titleCase } from "@/app/artist-slug";
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

  // `findArtist` is a best guess, not a lookup: it scores Deezer's 25 loosest hits and seeds
  // its reducer with the first of them, so as long as Deezer answered *anything* it answers
  // somebody. The search facet and the now-playing card both test the answer before they draw
  // it; this page — which is where both of them link — did not, so /artist/pump-glock rendered
  // Black Pumas' name, photograph, 106,373 followers and Deezer link under a heading and a
  // <title> that said Pump Glock. A name no catalogue recognises is a name with no artist
  // behind it, which is a state this page already knows how to render.
  const found = await findArtist(name);
  const artist = found && isSameArtist(name, found.name) ? found : null;
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
