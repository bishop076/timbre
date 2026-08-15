"use client";

import { cover as coverSrc } from "./artwork-url";
import { NoteIcon } from "./icons";

/* Several covers as one picture, for a collection nobody drew a sleeve for. Scattered
 * and tilted, not tiled: a flush 2×2 grid reads as a quadrant chart. */

/** One cover's width as a fraction of the frame. Width, not height — these are square and the frame is 4:3. */
const COVER = 30;

/** Where each cover sits, in percentages. Every position leaves room for the tilt — at `top: 0` the lifted corners are sliced off. */
const SCATTER = [
  { left: 5, top: 12, rotate: -8 },
  { left: 35, top: 6, rotate: 5 },
  { left: 65, top: 12, rotate: -4 },
  { left: 19, top: 46, rotate: 7 },
  { left: 49, top: 52, rotate: -6 },
] as const;

/** A collection's own covers, scattered into one picture. */
export function Collage({
  covers,
  className = "",
  rounded = "rounded-[var(--r-lg)]",
}: {
  covers: string[];
  className?: string;
  rounded?: string;
}) {
  const usable = covers.filter(Boolean).slice(0, SCATTER.length);

  if (usable.length === 0) {
    return (
      <div
        className={`flex items-center justify-center bg-[var(--surface-2)] text-[var(--fg-faint)] ${rounded} ${className}`}
      >
        <NoteIcon className="size-7" />
      </div>
    );
  }

  // Under three there is nothing to scatter — two tilted squares read as a mistake.
  if (usable.length < 3) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- artwork comes from arbitrary source CDNs
      <img
        // Full frame: these cards top out near 300px, so 600 covers a retina screen.
        src={coverSrc(usable[0], 600) ?? undefined}
        alt=""
        loading="lazy"
        decoding="async"
        className={`object-cover ${rounded} ${className}`}
      />
    );
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {usable.map((cover, index) => {
        const spot = SCATTER[index]!;
        return (
          // eslint-disable-next-line @next/next/no-img-element -- artwork comes from arbitrary source CDNs
          <img
            key={`${cover}-${index}`}
            // A tile draws near 90px, so 200 covers retina; asking for 500 was most of
            // Explore's page weight.
            src={coverSrc(cover, 200) ?? undefined}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute aspect-square rounded-[5px] object-cover shadow-[0_4px_14px_rgba(0,0,0,0.45)]"
            style={{
              width: `${COVER}%`,
              left: `${spot.left}%`,
              top: `${spot.top}%`,
              transform: `rotate(${spot.rotate}deg)`,
              // Later covers over earlier ones, so overlaps read as one stack.
              zIndex: index,
            }}
          />
        );
      })}
    </div>
  );
}
