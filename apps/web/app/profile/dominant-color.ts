"use client";

/**
 * The strongest colour in one image, for the profile header's flat wash. Separate from
 * `player/use-artwork-accent`, which buckets the same way but repaints the whole app by
 * writing CSS variables on the document root. Averaging is not an option — opposing hues
 * cancel and return mud — so pixels are bucketed by hue and the heaviest bucket wins.
 */

import { useEffect, useState } from "react";

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h, s, l];
}

const BUCKETS = 24;

function dominant(data: Uint8ClampedArray): Hsl | null {
  const weight = new Float64Array(BUCKETS);
  const hueSum = new Float64Array(BUCKETS);
  const satSum = new Float64Array(BUCKETS);
  const litSum = new Float64Array(BUCKETS);

  for (let i = 0; i < data.length; i += 16) {
    if (data[i + 3]! < 128) continue;

    const [h, s, l] = rgbToHsl(data[i]!, data[i + 1]!, data[i + 2]!);
    // Near-black, near-white and near-grey carry no hue and must not win on count alone.
    if (s < 0.18 || l < 0.12 || l > 0.92) continue;

    const score = s * s * (1 - Math.abs(l - 0.5) * 1.4);
    if (score <= 0) continue;

    const bucket = Math.min(BUCKETS - 1, Math.floor(h * BUCKETS));
    weight[bucket]! += score;
    hueSum[bucket]! += h * score;
    satSum[bucket]! += s * score;
    litSum[bucket]! += l * score;
  }

  let best = -1;
  let bestWeight = 0;
  for (let i = 0; i < BUCKETS; i += 1) {
    if (weight[i]! > bestWeight) {
      bestWeight = weight[i]!;
      best = i;
    }
  }
  if (best < 0) return null;

  return {
    h: hueSum[best]! / bestWeight,
    s: satSum[best]! / bestWeight,
    l: litSum[best]! / bestWeight,
  };
}

export interface Sample {
  /** The colour, or null for an image that has none — greyscale, or unreadable. */
  color: Hsl | null;
  /** Whether the question has been answered for *this* source. Without it "still decoding"
   * and "decoded, no dominant hue" are one value, and the header — which waits for a colour
   * before painting — waited forever on a black-and-white picture. */
  settled: boolean;
}

/** Reads the dominant colour of an image. Only pointed at a local blob or data URL or
 * Timbre's own `/api/art` proxy: a cross-origin CDN taints the canvas and makes
 * `getImageData` throw, silently and totally. */
export function useDominantColor(src: string | null): Sample {
  /* Stored with the source it came from and matched at render, not cleared in the effect,
   * which would be a second render pass to undo the first. A stale result is unsettled but
   * still hands its colour back: the avatar arrives as a thumbnail then the full copy of the
   * same picture, so dropping it in between lost the header's wash on every load. */
  const [found, setFound] = useState<{ src: string; color: Hsl | null } | null>(null);

  useEffect(() => {
    if (!src) return;

    let cancelled = false;
    const image = new Image();
    // Only for a real network source: a `blob:` URL is already this document's own, and
    // asking for CORS on one only adds a way to fail invisibly.
    if (/^https?:/.test(src)) image.crossOrigin = "anonymous";

    image.onload = () => {
      if (cancelled) return;
      try {
        // 48px is plenty: a dominant colour survives heavy downscaling.
        const size = 48;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return;
        context.drawImage(image, 0, 0, size, size);
        setFound({ src, color: dominant(context.getImageData(0, 0, size, size).data) });
      } catch {
        // Tainted canvas. The caller's fallback colour is the right answer.
        setFound({ src, color: null });
      }
    };
    image.onerror = () => {
      if (!cancelled) setFound({ src, color: null });
    };

    image.src = src;

    return () => {
      cancelled = true;
    };
  }, [src]);

  // No source is a settled answer in itself, or a caller waiting for one waits for ever.
  if (!src) return { color: null, settled: true };

  return { color: found?.color ?? null, settled: found?.src === src };
}
