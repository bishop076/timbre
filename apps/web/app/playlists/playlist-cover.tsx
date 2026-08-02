"use client";

import { Artwork } from "../artwork";

/**
 * A playlist's cover, built from the songs inside it.
 *
 * Timbre hosts nothing, and that holds for pictures as much as for audio —
 * there is no upload here and no image on any Timbre server. A playlist looks
 * like what is in it, which is also the honest answer: the cover changes when
 * the contents do, and can never be stale or misleading about them.
 *
 * Four covers make a grid, one fills the square, and two or three repeat to
 * fill rather than leaving a hole — an L-shaped cover with one empty cell reads
 * as a rendering bug, while a repeat reads as a pattern.
 *
 * Every cell is an <Artwork>, so a dead thumbnail degrades to the note
 * placeholder in that cell alone instead of breaking the grid.
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

  // Cycle the available covers up to four. With two, that is each one twice on
  // a diagonal; with three, the first repeats in the last cell.
  const cells = Array.from({ length: 4 }, (_, index) => usable[index % usable.length]!);

  return (
    <span className={`grid grid-cols-2 grid-rows-2 overflow-hidden ${className}`}>
      {cells.map((src, index) => (
        <Artwork
          // Position-keyed on purpose: the same url legitimately appears twice
          // when fewer than four covers are cycled to fill the grid.
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
