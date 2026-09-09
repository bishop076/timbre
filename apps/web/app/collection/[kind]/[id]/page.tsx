import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { fetchCollection, type CollectionKind } from "@/lib/collection";

import { CollectionView } from "../../../collection-view";

/**
 * One page for a genre chart, a Deezer playlist, or a mood.
 *
 * Three kinds share a route because they render identically — see
 * `lib/collection.ts`. Splitting them into three routes would mean three pages
 * to keep in step for a difference nobody looking at the screen can see.
 */
const KINDS = new Set<CollectionKind>(["genre", "playlist", "mood", "radio"]);

/** A quarter of an hour — a station's draw and a genre's rotation last that long (see
 * `STATION_PERIOD_MS`). A literal, because Next reads this statically. Playlists and charts
 * keep their own longer fetch caches, so a rebuild of one of those costs no request. */
export const revalidate = 900;

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

  const collection = await fetchCollection(parsed, id);
  return { title: collection ? `${collection.title} — Timbre` : "Not found — Timbre" };
}

// `id` arrives decoded — the route matcher has already done it, and `artist/[name]` relies on
// the same — so decoding it again double-decoded a `%25` and threw a `URIError` on a bare
// `%`, which is a 500 where a 404 belongs.
export default async function CollectionPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  const { kind, id } = await params;
  const parsed = parse(kind);
  if (!parsed) notFound();

  const collection = await fetchCollection(parsed, id);
  // A genre with an empty chart and a playlist that has been deleted are the
  // same thing to a reader: this address has nothing behind it.
  if (!collection) notFound();

  return <CollectionView collection={collection} />;
}
