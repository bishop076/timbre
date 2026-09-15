"use client";

import { ErrorPanel } from "@/app/failure-panel";

export default function AlbumError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <ErrorPanel where="The album page" title="Deezer didn’t answer for this album." error={error} retry={retry}>
      The tracklist for a release comes from Deezer, and this request came back empty or not at
      all. It is almost always momentary — the page is cached for an hour once it loads, so a
      retry that works, stays working.
    </ErrorPanel>
  );
}
