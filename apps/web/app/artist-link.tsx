"use client";

import Link from "next/link";

import { toArtistSlug } from "./artist-slug";

/**
 * The artist under a song title, as a link.
 *
 * It was a `<span role="link" tabIndex={0}>` with a click handler and a keydown handler
 * reimplementing what an anchor does for free — and doing it worse, because a fake link has no
 * href: no middle-click, no "open in new tab", no status bar, nothing for a reader to list under
 * "links on this page". It is an `<a>` now.
 *
 * `pointer-events-auto` and the stacking order matter as much as the element does. These sit
 * inside rows whose play button covers the whole line; the row turns the pointer off for its text
 * so the click lands on Play, and this is the part that turns it back on for itself.
 */
export function ArtistLink({
  artists,
  className = "",
}: {
  artists: string[];
  className?: string;
}) {
  const primary = artists[0];

  if (!primary) return <span className={className}>Unknown artist</span>;

  return (
    <Link
      href={`/artist/${toArtistSlug(primary)}`}
      onClick={(event) => event.stopPropagation()}
      title={`Go to ${primary}`}
      className={`pointer-events-auto relative z-10 rounded-[var(--r-sm)] hover:text-[var(--fg)] hover:underline ${className}`}
    >
      {artists.join(", ")}
    </Link>
  );
}
