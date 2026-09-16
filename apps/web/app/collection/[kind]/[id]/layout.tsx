import { notFound } from "next/navigation";

import { loadCollection } from "./collection";

/**
 * Above `loading.tsx` on purpose — see the long note in `app/album/[id]/layout.tsx`. The Suspense
 * boundary that file creates has its shell served with the status already on it, so a
 * `notFound()` raised inside the page answered 200 and the empty-collection panel arrived after
 * the fact. Deciding it here puts the 404 on the status line, where a monitor can read it.
 *
 * As in the album segment, only a definite `null` is an absence: `fetchCollection` throwing is
 * the source failing to answer, which is `error.tsx`'s business and stays inside the boundary.
 */
export default async function CollectionLayout({
  children,
  params,
}: LayoutProps<"/collection/[kind]/[id]">) {
  const { kind, id } = await params;
  const collection = await loadCollection(kind, id).catch(() => undefined);
  if (collection === null) notFound();

  return children;
}
