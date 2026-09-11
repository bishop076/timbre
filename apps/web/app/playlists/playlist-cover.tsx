"use client";

import { Artwork } from "../artwork";

export function PlaylistCover({
  covers,
  className,
  iconClassName = "size-8",
  eager,
}: {
  covers: string[];
  className: string;
  iconClassName?: string;
  eager?: boolean;
}) {
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
