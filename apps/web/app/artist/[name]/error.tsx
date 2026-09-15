"use client";

import { ErrorPanel } from "@/app/failure-panel";

export default function ArtistError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <ErrorPanel where="The artist page" title="None of the sources answered for this artist." error={error} retry={retry}>
      An artist page is assembled from several services at once, and this time not one of them
      came back. That usually means the network, not the artist.
    </ErrorPanel>
  );
}
