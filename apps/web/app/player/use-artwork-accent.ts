"use client";

import { useEffect, useRef } from "react";

import { buildPalette, type Palette, type Swatch } from "../theme/palette";
import { getThemeSnapshot, isLightTheme, useTheme, type ThemeState } from "../theme/theme-store";

// Recolours the app from the current track's artwork. Averaging the pixels returns mud,
// because opposing hues cancel, so pixels are bucketed by hue, scored on saturation and
// distance from both lightness extremes, and the winning region of the wheel decides. A
// tainted canvas makes `getImageData` throw: failure is silent and total.

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

// Fine enough to separate teal from green, coarse enough that noise cannot split a hue.
const BUCKETS = 24;

// Neighbours counted with the winner: a hue straddling a boundary must not lose to a
// lesser one mid-bucket — red lives at both ends, so it splits across buckets 23 and 0.
const WINDOW = 1;

function dominantHue(data: Uint8ClampedArray): { h: number; s: number; l: number } | null {
  const weight = new Float64Array(BUCKETS);
  const sinSum = new Float64Array(BUCKETS);
  const cosSum = new Float64Array(BUCKETS);
  const satSum = new Float64Array(BUCKETS);
  const litSum = new Float64Array(BUCKETS);

  for (let i = 0; i < data.length; i += 16) {
    const alpha = data[i + 3]!;
    if (alpha < 128) continue;

    const [h, s, l] = rgbToHsl(data[i]!, data[i + 1]!, data[i + 2]!);

    // Near-black, near-white and near-grey carry no hue and must not win by count.
    if (s < 0.18 || l < 0.12 || l > 0.92) continue;

    const score = s * s * (1 - Math.abs(l - 0.5) * 1.4);
    if (score <= 0) continue;

    const bucket = Math.min(BUCKETS - 1, Math.floor(h * BUCKETS));
    const angle = h * Math.PI * 2;
    weight[bucket]! += score;
    sinSum[bucket]! += Math.sin(angle) * score;
    cosSum[bucket]! += Math.cos(angle) * score;
    satSum[bucket]! += s * score;
    litSum[bucket]! += l * score;
  }

  let best = -1;
  let bestWeight = 0;
  for (let i = 0; i < BUCKETS; i++) {
    let total = 0;
    for (let offset = -WINDOW; offset <= WINDOW; offset++) {
      total += weight[(i + offset + BUCKETS) % BUCKETS]!;
    }
    if (total > bestWeight) {
      bestWeight = total;
      best = i;
    }
  }
  if (best < 0 || bestWeight === 0) return null;

  // The peak bucket plus any neighbour carrying a real share of it — averaging the whole
  // window dragged distinct hues toward the middle of a 45° span and came out muddy.
  const peak = weight[best]!;
  let sin = 0;
  let cos = 0;
  let sat = 0;
  let lit = 0;
  let total = 0;
  for (let offset = -WINDOW; offset <= WINDOW; offset++) {
    const bucket = (best + offset + BUCKETS) % BUCKETS;
    if (offset !== 0 && weight[bucket]! < peak * 0.5) continue;
    sin += sinSum[bucket]!;
    cos += cosSum[bucket]!;
    sat += satSum[bucket]!;
    lit += litSum[bucket]!;
    total += weight[bucket]!;
  }

  // The circular mean: red sits at both 0.98 and 0.02, and averaging those as plain
  // numbers gives 0.5 — cyan, the exact opposite. Unit vectors have no seam.
  const angle = Math.atan2(sin / total, cos / total);

  return {
    h: (((angle / (Math.PI * 2)) % 1) + 1) % 1,
    s: sat / total,
    l: lit / total,
  };
}

// The last colour the app wore. With nothing playing there is no artwork to sample, so
// every refresh reset the interface to the default purple until something was played.
const SWATCH_KEY = "timbre:swatch";

function rememberSwatch(swatch: Swatch): void {
  try {
    window.localStorage.setItem(SWATCH_KEY, JSON.stringify(swatch));
  } catch {
    // Private browsing or a full quota.
  }
}

function lastSwatch(): Swatch | null {
  try {
    const raw = window.localStorage.getItem(SWATCH_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    const { hue, sat } = (parsed ?? {}) as Partial<Swatch>;
    // Shape-checked: a `NaN` hue would produce `hsl(NaN …)` on every surface at once.
    return Number.isFinite(hue) && Number.isFinite(sat)
      ? { hue: hue as number, sat: sat as number }
      : null;
  } catch {
    return null;
  }
}

// The last palette painted, replayed before the next first paint — the blocking script can
// only set the ground, so the first paint used the static fallback ramp and the real one
// arrived on hydration: the black-then-purple flash. The *output* is cached, not the
// inputs, since a second `buildPalette` in the inline script would drift.
const PALETTE_KEY = "timbre:palette";

function rememberPalette(palette: Palette, theme: ThemeState): void {
  try {
    window.localStorage.setItem(
      PALETTE_KEY,
      JSON.stringify({
        vars: palette,
        theme: isLightTheme(theme) ? "light" : "dark",
        mode: theme.mode,
        neutral: theme.mode === "custom" && theme.customNeutral,
      }),
    );
  } catch {
    // Quota or private browsing.
  }
}

function apply(swatch: Swatch | null, theme: ThemeState): void {
  const root = document.documentElement;
  const palette = buildPalette(swatch, theme);

  if (swatch) rememberSwatch(swatch);
  rememberPalette(palette, theme);

  for (const [token, value] of Object.entries(palette)) {
    root.style.setProperty(token, value);
  }
  root.dataset.theme = isLightTheme(theme) ? "light" : "dark";
  // Mode as well as ground: pastel needs a quieter backdrop than a custom light.
  root.dataset.mode = theme.mode;
  // Neutral suppresses the blurred-cover backdrop — see globals.css.
  root.dataset.neutral = String(theme.mode === "custom" && theme.customNeutral);
}

export function useArtworkAccent(artworkUrl: string | null | undefined): void {
  // Subscribed for re-runs; the value itself is read live inside the effect.
  const subscribed = useTheme();
  const themeKey = `${subscribed.mode}:${subscribed.customHue}:${subscribed.customLight}:${subscribed.customNeutral}`;

  // Avoids re-reading the same image on an unrelated re-render; position ticks 2Hz.
  const lastUrl = useRef<string | null>(null);

  useEffect(() => {
    // Read live, not from the render. `useTheme()` returns the server default during
    // hydration, and this effect's first run is on that commit, so `apply()` overwrote the
    // `data-theme` the blocking script had stamped — turning the whole app black for a
    // moment on every load. `getThemeSnapshot()` reads storage on its first client call.
    const theme = getThemeSnapshot();

    // A fixed theme never samples. The backdrop is still set — that is the cover itself.
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
      // The colour the last cover gave it, not the default purple — see `lastSwatch`.
      apply(lastSwatch(), theme);
      return;
    }
    // Keyed on theme too: switching mode mid-song repaints, and the URL has not changed.
    if (lastUrl.current === `${theme.mode}:${artworkUrl}`) return;
    lastUrl.current = `${theme.mode}:${artworkUrl}`;

    document.documentElement.style.setProperty(
      "--artwork-img",
      `url("/api/art?u=${encodeURIComponent(artworkUrl)}")`,
    );

    // Aborted on cleanup, so a decode in flight from the previous track cannot land its
    // colour after the track has changed.
    let cancelled = false;
    const image = new Image();
    // Harmless now the source is same-origin, kept in case the proxy is bypassed.
    image.crossOrigin = "anonymous";

    image.onload = () => {
      if (cancelled) return;
      try {
        // 48px is plenty; a dominant colour survives heavy downscaling.
        const size = 48;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(image, 0, 0, size, size);
        const found = dominantHue(ctx.getImageData(0, 0, size, size).data);
        apply(found && { hue: found.h * 360, sat: found.s }, theme);
      } catch {
        // Tainted canvas: this CDN does not allow pixel reads.
        apply(null, theme);
      }
    };

    image.onerror = () => {
      if (!cancelled) apply(null, theme);
    };

    // Through `/api/art`, not the CDN: content blockers filter by hostname and
    // `i.ytimg.com` is on enough lists that the image never loads for anyone running one,
    // so `onerror` fires and the app silently falls back to purple on every song. A
    // first-party request matches no blocklist and cannot taint the canvas.
    image.src = `/api/art?u=${encodeURIComponent(artworkUrl)}`;

    return () => {
      cancelled = true;
    };
    // `themeKey`, not the theme object: the store hands out a fresh object per write.
  }, [artworkUrl, themeKey]);
}
