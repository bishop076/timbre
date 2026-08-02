import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { fetchAlbum } from "@/lib/discography";

import { AlbumView } from "../album-view";

/**
 * One release, with its running order.
 *
 * The tracklist is the whole reason this page exists. Searching an album's name
 * returns its songs in popularity order, jumbled with covers, live cuts and
 * anything that shares a word — an order is the one thing search cannot
 * reconstruct, and Deezer publishes it for free.
 *
 * Nothing here plays *from* Deezer, whose audio needs a subscription. Each row
 * carries only Deezer's identity for the recording, and picking one sends the
 * player to find a copy it can actually drive — the same path a chart entry
 * already takes.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const album = await fetchAlbum((await params).id).catch(() => null);
  return { title: album ? `${album.title} — ${album.artist} — Timbre` : "Album — Timbre" };
}

export default async function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const album = await fetchAlbum((await params).id).catch(() => null);
  if (!album) notFound();

  return <AlbumView album={album} />;
}
