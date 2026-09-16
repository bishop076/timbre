import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CollectionView } from "../../../collection-view";

import { loadCollection } from "./collection";

export const revalidate = 900;
export const dynamic = "force-static";

type Props = { params: Promise<{ kind: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { kind, id } = await params;
  const collection = await loadCollection(kind, id);
  return { title: collection ? `${collection.title} — Timbre` : "Not found — Timbre" };
}

export default async function CollectionPage({ params }: Props) {
  const { kind, id } = await params;
  const collection = await loadCollection(kind, id);
  // Settled by layout.tsx above the Suspense boundary that loading.tsx creates, so that the 404
  // is on the status line and not only in the words; this is what narrows the type here.
  if (!collection) notFound();

  return <CollectionView collection={collection} />;
}
