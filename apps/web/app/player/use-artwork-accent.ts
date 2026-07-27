"use client";

import { useEffect, useRef } from "react";

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

/** The palette in globals.css, restored whenever artwork can't be read. */
const FALLBACK = { light: "#6d28d9", dark: "#a78bfa" };

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

function hslToCss(h: number, s: number, l: number): string {
  return `hsl(${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
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

function apply(color: { h: number; s: number; l: number } | null): void {
  const root = document.documentElement;
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;

  if (!color) {
    root.style.setProperty("--accent", dark ? FALLBACK.dark : FALLBACK.light);
    root.style.setProperty("--accent-fg", dark ? "#0b0b0f" : "#ffffff");
    root.style.setProperty(
      "--accent-wash",
      dark ? "rgba(167, 139, 250, 0.14)" : "rgba(109, 40, 217, 0.1)",
    );
    return;
  }

  // Clamp into a band that stays legible against the ground it sits on. A
  // washed-out cover must not produce an invisible accent, and a neon one must
  // not produce something that vibrates.
  const s = Math.min(0.82, Math.max(0.45, color.s));
  const l = dark
    ? Math.min(0.74, Math.max(0.58, color.l))
    : Math.min(0.5, Math.max(0.34, color.l));

  root.style.setProperty("--accent", hslToCss(color.h, s, l));
  // Text sitting *on* the accent flips with its lightness, so contrast holds
  // whichever colour the artwork produced.
  root.style.setProperty("--accent-fg", l > 0.55 ? "#0b0b0f" : "#ffffff");
  root.style.setProperty(
    "--accent-wash",
    `hsl(${Math.round(color.h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}% / ${dark ? 0.16 : 0.1})`,
  );
}

export function useArtworkAccent(artworkUrl: string | null | undefined): void {
  // Avoids re-reading the same image when the component re-renders for an
  // unrelated reason — position ticks twice a second.
  const lastUrl = useRef<string | null>(null);

  useEffect(() => {
    if (!artworkUrl) {
      lastUrl.current = null;
      apply(null);
      return;
    }
    if (lastUrl.current === artworkUrl) return;
    lastUrl.current = artworkUrl;

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
        apply(dominantHue(ctx.getImageData(0, 0, size, size).data));
      } catch {
        // Tainted canvas — this CDN does not allow reading its pixels.
        apply(null);
      }
    };

    image.onerror = () => {
      if (!cancelled) apply(null);
    };

    image.src = artworkUrl;

    return () => {
      cancelled = true;
    };
  }, [artworkUrl]);
}
