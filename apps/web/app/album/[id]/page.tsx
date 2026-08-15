import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { fetchAlbum } from "@/lib/discography";

import { AlbumView } from "../album-view";

// One release, with its running order — the whole reason this page exists, since search
// returns an album's songs in popularity order jumbled with covers and live cuts. Nothing
// plays *from* Deezer: each row carries only Deezer's identity, and picking one sends the
// player to find a copy it can drive.

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
