import { isLightTheme, type ThemeState } from "./theme-store.ts";

export interface Swatch {
  hue: number;
  sat: number;
}

export type Palette = Record<string, string>;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/* ---------------------------------------------------------------------------
   Colour maths.

   The ramp is built in OKLCH rather than HSL. In HSL, "lightness 50%" means
   something different at every hue — a yellow at 50% is far brighter than a blue
   at 50% — so a palette built by holding L fixed across hues drifts in apparent
   contrast as the accent moves. That is exactly what happens here: the accent
   hue is sampled from album artwork, so it is whatever the artwork happens to
   be. OKLCH's L is perceptual, so the same number is the same brightness at
   every hue and the ramp holds together for any input.

   We still take the hue in HSL degrees, because that is what the artwork sampler
   produces, so it is converted rather than reinterpreted — HSL 258 (violet) is
   OKLCH ~293, and using the number unconverted would shift every theme.
   --------------------------------------------------------------------------- */

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

function linearToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** The OKLCH hue angle matching an HSL hue at a reference tone. */
export function hslHueToOklch(hslHue: number): number {
  const [r, g, b] = hslToRgb(((hslHue % 360) + 360) % 360, 0.9, 0.5);
  const [, a, bb] = linearToOklab(toLinear(r), toLinear(g), toLinear(b));
  return ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
}

/** sRGB channels for an OKLCH triple, clipped to gamut. */
export function oklchToRgb(L: number, C: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const [r, g, b] = oklabToLinear(L, C * Math.cos(h), C * Math.sin(h));
  return [toGamma(r), toGamma(g), toGamma(b)].map((c) => clamp(c, 0, 1)) as [
    number,
    number,
    number,
  ];
}

/** WCAG relative luminance. */
function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * The readable foreground for a background, picked rather than guessed.
 *
 * This is the bug that used to live here. `--accent-fg` was authored as its own
 * tone — `tone(0.98, …)` in light mode, `tone(0.08, …)` in dark — independent of
 * whatever `--accent` had become. Since the accent hue and saturation come from
 * album artwork, the two could drift into each other and the text on a button
 * would fall below AA with nothing to catch it.
 *
 * It is now derived. For every sRGB colour, max(contrast vs white, contrast vs
 * black) >= 4.5 — the two curves cross at luminance 0.1791, where both sides are
 * 4.54 — so simply taking the better of the two can never fail AA. Returning the
 * measured ratio as well lets callers and tests assert it.
 */
export function readableOn(rgb: [number, number, number]): { fg: string; ratio: number } {
  const bg = luminance(rgb);

  // Preferred pair first: white, and the brand's near-black rather than a flat
  // #000, which is what the rest of the UI uses. Near-black is *not* black
  // though, so it carries slightly less contrast and the guarantee below does
  // not cover it — measure it rather than assume it.
  const candidates: [string, number][] = [
    ["#ffffff", contrast(bg, 1)],
    ["#0b0a14", contrast(bg, luminance([0.043, 0.039, 0.078]))],
  ];
  const best = candidates.reduce((a, b) => (b[1] > a[1] ? b : a));
  if (best[1] >= 4.5) return { fg: best[0], ratio: best[1] };

  // Only pure white and pure black are guaranteed: their contrast curves cross
  // at luminance 0.1791, where both sit at 4.54, so the better of the two is
  // never below 4.5. Fall back to them when the softer pair is not enough.
  const onWhite = contrast(bg, 1);
  const onBlack = contrast(bg, 0);
  return onWhite >= onBlack
    ? { fg: "#ffffff", ratio: onWhite }
    : { fg: "#000000", ratio: onBlack };
}

export function buildPalette(swatch: Swatch | null, theme: ThemeState): Palette {
  const light = isLightTheme(theme);
  const custom = theme.mode === "custom";
  const neutral = custom && theme.customNeutral;

  const hslHue = Math.round(custom ? theme.customHue : (swatch?.hue ?? (light ? 262 : 258)));
  const hue = hslHueToOklch(hslHue);
  const sat = neutral ? 0.04 : custom ? 0.62 : swatch ? clamp(swatch.sat, 0.3, 0.7) : 0.5;

  // Chroma in OKLCH is an absolute distance, not a percentage: ~0.03 is a barely
  // tinted grey and ~0.2 is as saturated as sRGB reaches. Surfaces stay near the
  // bottom of that range so the page reads as neutral with a cast, the way both
  // reference apps do, rather than as a coloured page.
  const chroma = (amount: number) => Math.round(clamp(amount, 0, 0.37) * 1000) / 1000;
  const tone = (L: number, C: number) => `oklch(${L.toFixed(3)} ${chroma(C)} ${hue.toFixed(1)})`;
  const veil = (L: number, C: number, alpha: number) =>
    `oklch(${L.toFixed(3)} ${chroma(C)} ${hue.toFixed(1)} / ${alpha})`;

  // Shadows are ambient now, not the hard `Npx Npx 0` offset that made every
  // surface look like a sticker. Two layers: a tight contact shadow and a wide
  // soft one, which is what reads as "lifted" rather than "drawn".
  const drops = (L: number, C: number, a1: number, a2: number) => ({
    "--drop": `0 1px 2px ${veil(L, C, a1)}, 0 4px 14px ${veil(L, C, a2)}`,
    "--drop-sm": `0 1px 2px ${veil(L, C, a1 + 0.01)}`,
    "--drop-lg": `0 10px 32px ${veil(L, C, a2 + 0.04)}`,
  });

  const accentChroma = neutral ? sat * 0.06 : clamp(sat * 0.28, 0.08, 0.2);

  function withAccent(accentL: number, rest: Palette, chromaScale = 1): Palette {
    const C = chroma(accentChroma * chromaScale);
    const { fg } = readableOn(oklchToRgb(accentL, C, hue));
    return { ...rest, "--accent": tone(accentL, C), "--accent-fg": fg };
  }

  if (theme.mode === "pastel") {
    // Pastel is the gentle ramp: the same hue, held back off full chroma.
    return withAccent(
      0.72,
      {
        "--bg": tone(0.972, sat * 0.05),
        "--surface-1": tone(1, 0),
        "--surface-2": tone(0.948, sat * 0.06),
        "--surface-3": tone(0.912, sat * 0.075),
        "--fg": tone(0.26, sat * 0.09),
        "--fg-dim": tone(0.49, sat * 0.05),
        "--fg-faint": tone(0.64, sat * 0.04),
        "--ink": veil(0.45, sat * 0.08, 0.12),
        "--line": veil(0.45, sat * 0.08, 0.12),
        "--accent-wash": veil(0.72, accentChroma * 0.72, 0.14),
        ...drops(0.45, sat * 0.08, 0.06, 0.08),
      },
      0.72,
    );
  }

  if (light) {
    return withAccent(neutral ? 0.36 : 0.54, {
      "--bg": tone(1, 0),
      "--surface-1": tone(0.974, sat * 0.035),
      "--surface-2": tone(0.952, sat * 0.045),
      "--surface-3": tone(0.922, sat * 0.055),
      "--fg": tone(0.22, sat * 0.05),
      "--fg-dim": tone(0.48, sat * 0.04),
      "--fg-faint": tone(0.63, sat * 0.035),
      "--ink": veil(0.3, sat * 0.06, 0.09),
      "--line": veil(0.3, sat * 0.06, 0.09),
      "--accent-wash": veil(0.54, accentChroma, 0.1),
      ...drops(0.25, sat * 0.06, 0.05, 0.06),
    });
  }

  return withAccent(0.74, {
    "--bg": tone(0.155, sat * 0.028),
    "--surface-1": tone(0.192, sat * 0.032),
    "--surface-2": tone(0.232, sat * 0.036),
    "--surface-3": tone(0.283, sat * 0.04),
    "--fg": tone(0.965, sat * 0.012),
    "--fg-dim": tone(0.762, sat * 0.016),
    "--fg-faint": tone(0.605, sat * 0.018),
    "--ink": veil(0.99, sat * 0.01, 0.09),
    "--line": veil(0.99, sat * 0.01, 0.09),
    "--accent-wash": veil(0.74, accentChroma, 0.16),
    ...drops(0.02, 0, 0.4, 0.45),
  });
}
