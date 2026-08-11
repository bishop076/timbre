"use client";

/**
 * The strongest colour in one image, for the profile header alone.
 *
 * Spotify's header is not a picture. It is a **flat wash of the profile
 * picture's dominant colour**, fading into the page — which is why their
 * profiles read as calm even when the avatar is busy. This produces that one
 * colour.
 *
 * Deliberately separate from `player/use-artwork-accent`, which does something
 * related but incompatible: that one *repaints the whole application* by
 * writing CSS variables on the document root, because the app is meant to take
 * on the colour of what is playing. A header cannot borrow it without
 * recolouring every surface behind it. The pixel-bucketing idea is the same and
 * the scope is the opposite.
 *
 * Averaging pixels is not an option and is worth saying once: opposing hues
 * cancel, so an average always returns mud. Pixels are bucketed by hue instead
 * and the heaviest bucket wins.
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
    // Near-black, near-white and near-grey carry no hue and are usually
    // background, so they must not win on count alone.
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
  /**
   * Whether the question has been answered for *this* source.
   *
   * **The reason this exists.** The hook used to return `Hsl | null` and
   * nothing else, so "still decoding" and "decoded, and there is no dominant
   * hue in it" were the same value. The profile header waits for a colour
   * before painting, so a black-and-white picture — or one that failed to load
   * — left it waiting forever and the header never got its wash at all. One
   * boolean is the whole difference between "not yet" and "never".
   */
  settled: boolean;
}

/**
 * Reads the dominant colour of an image.
 *
 * Only ever pointed at a local blob or data URL, or Timbre's own `/api/art`
 * proxy — all same-origin, since a cross-origin CDN would taint the canvas and
 * make `getImageData` throw. That failure is silent and total: no colour rather
 * than a half-applied one.
 */
export function useDominantColor(src: string | null): Sample {
  /*
   * The result is stored *with the source it came from*, and matched at render.
   *
   * Clearing it in the effect when `src` changes would be a second render pass
   * to undo the first. Comparing instead means a stale result is simply marked
   * unsettled — while its colour is still handed back, which matters more than
   * it sounds: the profile avatar arrives as a thumbnail and is then replaced
   * by the full-resolution copy of *the same picture*, so dropping the colour
   * in between made the header lose its wash and repaint it a moment later,
   * every single load.
   */
  const [found, setFound] = useState<{ src: string; color: Hsl | null } | null>(null);

  useEffect(() => {
    if (!src) return;

    let cancelled = false;
    const image = new Image();
    /*
     * Only for a real network source.
     *
     * A `blob:` or `data:` URL is already this document's own, and asking for
     * CORS on one buys nothing while adding a way for the load to fail — and a
     * failure here is invisible, because its only symptom is a header that
     * never takes its colour.
     */
    if (/^https?:/.test(src)) image.crossOrigin = "anonymous";

    image.onload = () => {
      if (cancelled) return;
      try {
        // 48px is plenty — a dominant colour survives heavy downscaling, and it
        // keeps the pixel loop trivial.
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

  // No source is a settled answer in itself: there is nothing to sample, and a
  // caller waiting for one would wait for ever.
  if (!src) return { color: null, settled: true };

  return { color: found?.color ?? null, settled: found?.src === src };
}

