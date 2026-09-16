import { notFound } from "next/navigation";

import { loadAlbum } from "./album";

/**
 * The whole job of this layout is to be *above* `loading.tsx`.
 *
 * `loading.tsx` wraps the page in a Suspense boundary, and Next prerenders that boundary's shell
 * for the route and serves it as the response — status and all — before the page underneath has
 * resolved. A `notFound()` from inside the page therefore arrived after the 200 was already
 * committed, and every missing album answered "200 OK" with the not-found panel streamed in
 * afterwards. A reader saw the right page; a link checker, a crawler and an uptime monitor saw a
 * success, and the ISR entry kept that 200 for an hour.
 *
 * A layout is outside its own segment's Suspense boundary, so the decision lands before the
 * first byte. The read is `cache`d, so the page below pays nothing for it.
 *
 * Only a definite `null` — Deezer answered, and had no such release — is an absence. A throw is
 * Deezer failing to answer, which belongs to `error.tsx` and its retry, so it is deliberately
 * left for the page to raise inside the boundary where that file can catch it.
 */
export default async function AlbumLayout({ children, params }: LayoutProps<"/album/[id]">) {
  const album = await loadAlbum((await params).id).catch(() => undefined);
  if (album === null) notFound();

  return children;
}
