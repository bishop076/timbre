import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { fetchCollection, type CollectionKind } from "@/lib/collection";

import { CollectionView } from "../../../collection-view";

const KINDS = new Set<CollectionKind>([
  "genre",
  "playlist",
  "mood",
  "radio",
  "spotify-album",
  "spotify-playlist",
  "ytmusic-playlist",
]);

export const revalidate = 900;
export const dynamic = "force-static";

const loadCollection = cache(async (kind: string, id: string) =>
  KINDS.has(kind as CollectionKind) ? fetchCollection(kind as CollectionKind, id) : null,
);

type Props = { params: Promise<{ kind: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { kind, id } = await params;
  const collection = await loadCollection(kind, id);
  return { title: collection ? `${collection.title} — Timbre` : "Not found — Timbre" };
}

export default async function CollectionPage({ params }: Props) {
  const { kind, id } = await params;
  const collection = await loadCollection(kind, id);
  if (!collection) notFound();

  return <CollectionView collection={collection} />;
}
