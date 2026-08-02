"use client";

import { useEffect, useRef } from "react";

import { buildPalette, type Swatch } from "../theme/palette";
import { isLightTheme, useTheme, type ThemeState } from "../theme/theme-store";

/**
 * Recolours the app from the current track's artwork.
 *
 * The idea is Material You's: the interface takes on the colour of what is
 * playing, so the player feels like part of the album rather than a chrome
 * wrapper around it. Implemented here for the web, from scratch.
 *
 * **Why the colour is chosen the way it is.** The naive approach — average the
 * pixels — always returns mud, because averaging opposing hues cancels them.
 * Instead pixels are bucketed by hue, each bucket scored on saturation and how
 * far its lightness sits from both extremes, and the winning bucket's colour is
 * then forced into a legible range. A dark album cover should still yield a
 * usable accent, not a black one.
 *
 * **Cross-origin is the real constraint.** Artwork comes from whichever CDN the
 * source uses, and reading pixels requires that CDN to allow it. When it does
 * not, the canvas is tainted and `getImageData` throws. That is expected, not
 * exceptional: the app simply keeps the default accent. Failure has to be
 * silent and total, never a half-applied colour.
 */

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

/** 24 hue buckets — fine enough to separate teal from green, coarse enough that
 *  gradients and compression noise don't split one colour across two. */
const BUCKETS = 24;

function dominantHue(data: Uint8ClampedArray): { h: number; s: number; l: number } | null {
  const weight = new Float64Array(BUCKETS);
  const hueSum = new Float64Array(BUCKETS);
  const satSum = new Float64Array(BUCKETS);
  const litSum = new Float64Array(BUCKETS);

  // Stride over the pixels; sampling every 4th is indistinguishable from
  // reading all of them and keeps this off the main thread's critical path.
  for (let i = 0; i < data.length; i += 16) {
    const alpha = data[i + 3]!;
    if (alpha < 128) continue;

    const [h, s, l] = rgbToHsl(data[i]!, data[i + 1]!, data[i + 2]!);

    // Near-black, near-white and near-grey pixels carry no hue information and
    // are usually background, so they must not win by sheer count.
    if (s < 0.18 || l < 0.12 || l > 0.92) continue;

    // Favour saturated pixels in the middle of the lightness range: those are
    // the colours a person would name if asked what the cover looks like.
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
  for (let i = 0; i < BUCKETS; i++) {
    if (weight[i]! > bestWeight) {
      bestWeight = weight[i]!;
      best = i;
    }
  }
  if (best < 0 || bestWeight === 0) return null;

  return {
    h: hueSum[best]! / bestWeight,
    s: satSum[best]! / bestWeight,
    l: litSum[best]! / bestWeight,
  };
}

/**
 * Writes a palette onto the document.
 *
 * The ramp itself lives in `theme/palette.ts` and is unit-tested; this only
 * puts it on the element. `data-theme` goes on too, so CSS that cannot be
 * expressed as a custom property — the ambient wash's exposure, which needs a
 * different filter on a light ground — can key off the same decision rather
 * than asking `prefers-color-scheme` and disagreeing with the palette.
 */
function apply(swatch: Swatch | null, theme: ThemeState): void {
  const root = document.documentElement;
  const palette = buildPalette(swatch, theme);

  for (const [token, value] of Object.entries(palette)) {
    root.style.setProperty(token, value);
  }
  root.dataset.theme = isLightTheme(theme) ? "light" : "dark";
  // The mode as well as the ground: pastel needs a quieter backdrop than a
  // custom light theme does, and "light" alone cannot express that.
  root.dataset.mode = theme.mode;
  // Neutral suppresses the blurred-cover backdrop entirely — see globals.css.
  root.dataset.neutral = String(theme.mode === "custom" && theme.customNeutral);
}

export function useArtworkAccent(artworkUrl: string | null | undefined): void {
  const theme = useTheme();

  // Avoids re-reading the same image when the component re-renders for an
  // unrelated reason — position ticks twice a second.
  const lastUrl = useRef<string | null>(null);

  useEffect(() => {
    /*
     * A fixed theme never looks at the artwork.
     *
     * Returning before the image is even fetched is the point of the mode: the
     * reader asked for one colour, so there is nothing to sample and no reason
     * to decode a cover to arrive at a value already known. The backdrop image
     * is still set, since that is the cover itself rather than a colour derived
     * from it.
     */
    if (theme.mode === "custom") {
      lastUrl.current = null;
      document.documentElement.style.setProperty(
        "--artwork-img",
        artworkUrl ? `url("/api/art?u=${encodeURIComponent(artworkUrl)}")` : "none",
      );
      apply(null, theme);
      return;
    }

    if (!artworkUrl) {
      lastUrl.current = null;
      document.documentElement.style.setProperty("--artwork-img", "none");
      apply(null, theme);
      return;
    }
    // The guard is keyed on the theme as well as the URL: switching mode while
    // a song plays has to repaint, and the URL will not have changed.
    if (lastUrl.current === `${theme.mode}:${artworkUrl}`) return;
    lastUrl.current = `${theme.mode}:${artworkUrl}`;

    /*
     * The cover itself, for the wash behind the content panel.
     *
     * Through `/api/art` for the same reason every other image is: a content
     * blocker filtering `i.ytimg.com` would otherwise leave the backdrop empty
     * on exactly the machines that need it most.
     */
    document.documentElement.style.setProperty(
      "--artwork-img",
      `url("/api/art?u=${encodeURIComponent(artworkUrl)}")`,
    );

    let cancelled = false;
    const image = new Image();
    // Without this the canvas is tainted and the read throws. With it, a CDN
    // that does not send CORS headers fails to load instead — either way the
    // outcome is the fallback accent, which is the correct result.
    image.crossOrigin = "anonymous";

    image.onload = () => {
      if (cancelled) return;
      try {
        // 48px is plenty: the dominant colour of a cover survives heavy
        // downscaling, and this keeps the pixel loop trivial.
        const size = 48;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(image, 0, 0, size, size);
        const found = dominantHue(ctx.getImageData(0, 0, size, size).data);
        // `dominantHue` works in 0–1; the palette takes degrees.
        apply(found && { hue: found.h * 360, sat: found.s }, theme);
      } catch {
        // Tainted canvas — this CDN does not allow reading its pixels.
        apply(null, theme);
      }
    };

    image.onerror = () => {
      if (!cancelled) apply(null, theme);
    };

    image.src = artworkUrl;

    return () => {
      cancelled = true;
    };
  }, [artworkUrl, theme]);
}
