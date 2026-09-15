"use client";

import Link from "next/link";

import { ErrorPanel, SECONDARY } from "@/app/failure-panel";

/**
 * A playlist is read out of this browser, not off a server, so a failure here is a failure to
 * read or parse local storage. The way out is the library rather than home: the other playlists
 * are almost certainly fine, and seeing them is the fastest way to tell.
 */
export default function PlaylistError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <ErrorPanel
      where="The playlist page"
      title="This playlist couldn’t be opened."
      error={error}
      retry={retry}
      actions={
        <Link href="/library" className={SECONDARY}>
          Your library
        </Link>
      }
    >
      Playlists live in this browser, so nothing was lost over the network — the record itself
      could not be read. Your other playlists are listed in your library.
    </ErrorPanel>
  );
}
