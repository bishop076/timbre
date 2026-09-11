import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { fetchAlbum } from "@/lib/discography";

import { AlbumView } from "../album-view";

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
