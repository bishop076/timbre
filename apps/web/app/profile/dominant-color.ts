"use client";

/**
 * The strongest colour in one image, for the profile header's flat wash. The sampling is
 * `../hue`, shared with `player/use-artwork-accent`, which asks the same question but
 * repaints the whole app by writing CSS variables on the document root.
 */

import { useEffect, useState } from "react";

import { sampleHue, type Hsl } from "../hue";

export interface Sample {
  /** The colour, or null for an image that has none — greyscale, or unreadable. */
  color: Hsl | null;
  /** Whether the question has been answered for *this* source. Without it "still decoding"
   * and "decoded, no dominant hue" are one value, and the header — which waits for a colour
   * before painting — waited forever on a black-and-white picture. */
  settled: boolean;
}

/** Reads the dominant colour of an image. */
export function useDominantColor(src: string | null): Sample {
  /* Stored with the source it came from and matched at render, not cleared in the effect,
   * which would be a second render pass to undo the first. A stale result is unsettled but
   * still hands its colour back: the avatar arrives as a thumbnail then the full copy of the
   * same picture, so dropping it in between lost the header's wash on every load. */
  const [found, setFound] = useState<{ src: string; color: Hsl | null } | null>(null);

  useEffect(() => {
    if (!src) return;
    return sampleHue(src, (color) => setFound({ src, color }));
  }, [src]);

  // No source is a settled answer in itself, or a caller waiting for one waits for ever.
  if (!src) return { color: null, settled: true };

  return { color: found?.color ?? null, settled: found?.src === src };
}
