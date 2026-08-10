"use client";

import { cover as coverSrc } from "./artwork-url";
import { NoteIcon } from "./icons";

/**
 * Several covers, as one picture.
 *
 * A collection assembled from a chart has no artwork — nobody drew a sleeve for
 * "top songs this week" — and borrowing one song's cover would claim the whole
 * thing belongs to that record. Its own covers, shown together, say what it
 * actually is.
 *
 * **Scattered and tilted rather than tiled**, which is Tidal's treatment and the
 * better one: a flush 2×2 grid reads as a quadrant chart and its seams line up
 * into a cross through the middle of the card. Loose, overlapping, slightly
 * rotated covers read as a stack of records.
 */

/**
 * How wide one cover is, as a fraction of the frame.
 *
 * Width, not height, and that is the whole trick. These are square, and the
 * frame is 4:3 — so a cover sized by *height* is a third wider than the same
 * number suggests, and a set that fits a square frame bursts out of a landscape
 * one. Sizing by width means the tallest a cover can get is a known fraction of
 * the frame's height, and the layout below is built around that.
 */
const COVER = 30;

/**
 * Where each cover sits, as percentages of the frame.
 *
 * Three across the top, two beneath, all clear of the edges — the earlier table
 * ran the top row to `top: 0`, and once a few degrees of rotation lifted their
 * corners the sleeves were sliced off against the frame. Every position leaves
 * room for the tilt.
 *
 * Ordered so any prefix still looks deliberate: the first three form the top
 * row. A collection with four covers is not a broken five.
 */
const SCATTER = [
  { left: 5, top: 12, rotate: -8 },
  { left: 35, top: 6, rotate: 5 },
  { left: 65, top: 12, rotate: -4 },
  { left: 19, top: 46, rotate: 7 },
  { left: 49, top: 52, rotate: -6 },
] as const;

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

  // Under three there is nothing to scatter — two tilted squares read as a
  // mistake rather than an arrangement — so the first is shown whole, exactly
  // like a collection that came with its own cover.
  if (usable.length < 3) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- artwork comes from arbitrary source CDNs
      <img
        // Shown whole, so it gets the full frame's worth: these cards are around
        // 300px at their largest, which is 600 device pixels on a retina screen.
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
            /*
              A tile is `COVER`% of a frame that is at most about 300px wide, so
              it draws at roughly 90px — 200 device pixels covers a retina screen
              with room to spare. It used to ask for 500×500 and there are five of
              these per collage, which is where most of Explore's weight was.
            */
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
              // Later covers sit over earlier ones, so the overlaps read as one
              // consistent stack rather than as tangled edges.
              zIndex: index,
            }}
          />
        );
      })}
    </div>
  );
}
