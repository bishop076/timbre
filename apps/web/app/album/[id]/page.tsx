import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AlbumView } from "../album-view";

import { loadAlbum } from "./album";

export const revalidate = 3600;
export const dynamic = "force-static";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const album = await loadAlbum((await params).id).catch(() => null);
  return { title: album ? `${album.title} — ${album.artist} — Timbre` : "Album — Timbre" };
}

export default async function AlbumPage({ params }: Props) {
  // Deliberately uncaught: `fetchAlbum` throws when Deezer could not answer, and this page is
  // force-static, so turning that into notFound() would cache the wrong answer for an hour.
  // The boundary in error.tsx offers a retry instead. The absent case is settled by layout.tsx,
  // above the Suspense boundary, so that a 404 reaches the status line; the check below is what
  // narrows the type down here.
  const album = await loadAlbum((await params).id);
  if (!album) notFound();

  return <AlbumView album={album} />;
}
