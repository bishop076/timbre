"use client";

import { Artwork } from "../artwork";

/**
 * A playlist's cover, built from the songs inside it. Four make a grid, one fills the
 * square, and two or three repeat to fill — an L-shape with an empty cell reads as a
 * rendering bug. Every cell is an `<Artwork>`, so a dead thumbnail degrades alone.
 */
export function PlaylistCover({
  covers,
  className = "",
  iconClassName = "size-8",
  eager,
}: {
  covers: string[];
  /** Applied to the wrapper, so the caller controls size and shape. */
  className?: string;
  iconClassName?: string;
  eager?: boolean;
}) {
  const usable = covers.filter(Boolean);

  // No songs, or none with artwork — one placeholder rather than four.
  if (usable.length === 0) {
    return <Artwork src={null} className={className} iconClassName={iconClassName} eager={eager} />;
  }

  if (usable.length === 1) {
    return (
      <Artwork src={usable[0]} className={className} iconClassName={iconClassName} eager={eager} />
    );
  }

  // Cycle up to four: two gives each one twice, three repeats the first last.
  const cells = Array.from({ length: 4 }, (_, index) => usable[index % usable.length]!);

  return (
    <span className={`grid grid-cols-2 grid-rows-2 overflow-hidden ${className}`}>
      {cells.map((src, index) => (
        <Artwork
          // Position-keyed: the same url legitimately appears twice when cycled.
          key={index}
          src={src}
          className="size-full"
          iconClassName="size-3"
          eager={eager}
        />
      ))}
    </span>
  );
}
