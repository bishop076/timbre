"use client";

import { Artwork } from "../artwork";

export function PlaylistCover({
  covers,
  coverUrl,
  uploaded,
  className,
  iconClassName = "size-8",
  eager,
}: {
  covers: string[];
  /** The picture the list came with, where it has one — Spotify's playlist art. */
  coverUrl?: string | null;
  /** A picture chosen here, as an object URL. Beats everything: it was picked on purpose. */
  uploaded?: string | null;
  className: string;
  iconClassName?: string;
  eager?: boolean;
}) {
  // An uploaded picture is already a blob in this browser, so it goes straight to an <img>
  // rather than through `/api/art`, which only proxies http(s).
  if (uploaded) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={uploaded} alt="" aria-hidden className={`object-cover ${className}`} />
    );
  }

  if (coverUrl) {
    return (
      <Artwork src={coverUrl} className={className} iconClassName={iconClassName} eager={eager} />
    );
  }

  if (covers.length < 2) {
    return (
      <Artwork
        src={covers[0] ?? null}
        className={className}
        iconClassName={iconClassName}
        eager={eager}
      />
    );
  }

  return (
    <span className={`grid grid-cols-2 grid-rows-2 overflow-hidden ${className}`}>
      {Array.from({ length: 4 }, (_, index) => (
        <Artwork
          key={index}
          src={covers[index % covers.length]}
          className="size-full"
          iconClassName="size-3"
          eager={eager}
        />
      ))}
    </span>
  );
}
