"use client";

import { ErrorPanel } from "@/app/failure-panel";

export default function CollectionError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <ErrorPanel where="The collection page" title="The source for this collection didn’t answer." error={error} retry={retry}>
      Charts, genres, stations and imported playlists each come from somewhere different —
      Deezer, YouTube Music or Spotify — and whichever one owns this page did not reply.
    </ErrorPanel>
  );
}
