import { notFound } from "next/navigation";

import { fromArtistSlug } from "@/app/artist-slug";

/**
 * Above `loading.tsx` on purpose — see the long note in `app/album/[id]/layout.tsx`. A slug that
 * unpicks to nothing is the one absence this route has, and deciding it here rather than in the
 * page puts the 404 on the status line instead of behind a 200. It costs nothing: no source is
 * asked, the answer is in the address.
 */
export default async function ArtistLayout({ children, params }: LayoutProps<"/artist/[name]">) {
  if (!fromArtistSlug((await params).name).trim()) notFound();

  return children;
}
