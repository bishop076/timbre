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

const loadCollection = cache(fetchCollection);

function parse(kind: string): CollectionKind | null {
  return KINDS.has(kind as CollectionKind) ? (kind as CollectionKind) : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}): Promise<Metadata> {
  const { kind, id } = await params;
  const parsed = parse(kind);
  if (!parsed) return { title: "Not found — Timbre" };

  const collection = await loadCollection(parsed, id);
  return { title: collection ? `${collection.title} — Timbre` : "Not found — Timbre" };
}

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  const { kind, id } = await params;
  const parsed = parse(kind);
  if (!parsed) notFound();

  const collection = await loadCollection(parsed, id);
  if (!collection) notFound();

  return <CollectionView collection={collection} />;
}
