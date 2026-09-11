import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { fetchAlbum } from "@/lib/discography";

import { AlbumView } from "../album-view";

export const revalidate = 3600;
export const dynamic = "force-static";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const album = await fetchAlbum((await params).id).catch(() => null);
  return { title: album ? `${album.title} — ${album.artist} — Timbre` : "Album — Timbre" };
}

export default async function AlbumPage({ params }: Props) {
  const album = await fetchAlbum((await params).id).catch(() => null);
  if (!album) notFound();

  return <AlbumView album={album} />;
}
