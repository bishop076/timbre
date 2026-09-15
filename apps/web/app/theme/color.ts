/**
 * The colour maths the customisation layer runs on: parse whatever the reader typed, move a
 * colour around in OKLCH, and — the part that is not negotiable — work out what is readable
 * on top of it.
 *
 * OKLCH rather than HSL because the reader picks one seed and everything else is derived from
 * it. HSL's lightness is not perceptual: hsl(60 100% 50%) and hsl(240 100% 50%) claim the same
 * lightness and differ by a factor of twenty in luminance, so a ramp built by holding L and
 * spinning the hue is legible at one hue and unreadable at the next. OKLCH holds still.
 *
 * Nothing here touches the DOM, so it is all testable under `node --test`.
 */

export interface Rgb {
  /** 0–1, gamma-encoded sRGB. */
  r: number;
  g: number;
  b: number;
}

export interface Oklch {
  /** 0–1. */
  l: number;
  /** 0–0.4 in practice; sRGB cannot hold much more. */
  c: number;
  /** Degrees, 0–360. */
  h: number;
}

export const WHITE: Rgb = { r: 1, g: 1, b: 1 };
export const BLACK: Rgb = { r: 0, g: 0, b: 0 };

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

const NAMED: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  grey: "#808080",
  gray: "#808080",
  silver: "#c0c0c0",
  red: "#ff0000",
  orange: "#ffa500",
  gold: "#ffd700",
  yellow: "#ffff00",
  lime: "#00ff00",
  green: "#008000",
  teal: "#008080",
  cyan: "#00ffff",
  blue: "#0000ff",
  navy: "#000080",
  indigo: "#4b0082",
  violet: "#ee82ee",
  purple: "#800080",
  magenta: "#ff00ff",
  pink: "#ffc0cb",
  brown: "#a52a2a",
  beige: "#f5f5dc",
  cream: "#f3efe4",
};

function hexDigits(text: string): Rgb | null {
  const digits = text.length === 3 || text.length === 4 ? text.replace(/./g, "$&$&") : text;
  if (digits.length !== 6 && digits.length !== 8) return null;
  if (!/^[0-9a-f]+$/i.test(digits)) return null;
  // An alpha pair is read and dropped: a seed colour has no opacity, and refusing #rrggbbaa
  // outright would reject what a colour picker in another application puts on the clipboard.
  return {
    r: parseInt(digits.slice(0, 2), 16) / 255,
    g: parseInt(digits.slice(2, 4), 16) / 255,
    b: parseInt(digits.slice(4, 6), 16) / 255,
  };
}

function numbers(body: string): number[] {
  return body
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map((part) => Number.parseFloat(part));
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const secondary = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const base = l - chroma / 2;
  const sextant = Math.floor(((((h % 360) + 360) % 360) / 60) % 6);
  const wheel: [number, number, number][] = [
    [chroma, secondary, 0],
    [secondary, chroma, 0],
    [0, chroma, secondary],
    [0, secondary, chroma],
    [secondary, 0, chroma],
    [chroma, 0, secondary],
  ];
  const [r, g, b] = wheel[sextant];
  return { r: r + base, g: g + base, b: b + base };
}

/**
 * Everything a reader might reasonably paste into a colour field: #a1b2c3, bare hex digits,
 * rgb(), hsl() and the couple of dozen colour words anyone types from memory. Anything else is
 * null, and the caller keeps the colour it already had — a half-typed hex code must never
 * repaint the app.
 */
export function parseColor(input: string): Rgb | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;

  const named = NAMED[text];
  if (named) return hexDigits(named.slice(1));

  if (text.startsWith("#")) return hexDigits(text.slice(1));

  const call = /^(rgba?|hsla?)\((.*)\)$/.exec(text);
  if (call) {
    const parts = numbers(call[2]);
    if (parts.length < 3 || parts.slice(0, 3).some((part) => !Number.isFinite(part))) return null;
    if (call[1].startsWith("rgb")) {
      const scale = call[2].includes("%") ? 100 : 255;
      return {
        r: clamp(parts[0] / scale, 0, 1),
        g: clamp(parts[1] / scale, 0, 1),
        b: clamp(parts[2] / scale, 0, 1),
      };
    }
    return hslToRgb(parts[0], clamp(parts[1] / 100, 0, 1), clamp(parts[2] / 100, 0, 1));
  }

  return hexDigits(text);
}

export function toHex({ r, g, b }: Rgb): string {
  const channel = (value: number) =>
    Math.round(clamp(value, 0, 1) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Normalises anything readable to #rrggbb, or null. The one gate on stored colours. */
export function normaliseHex(input: string): string | null {
  const rgb = parseColor(input);
  return rgb ? toHex(rgb) : null;
}

export function isHex(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/.test(value);
}

/* ------------------------------------------------------------------ sRGB ⇄ OKLCH */

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

export function rgbToOklch({ r, g, b }: Rgb): Oklch {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);

  const long = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const medium = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const short = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  const l = 0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short;
  const a = 1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short;
  const blue = 0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short;

  const c = Math.hypot(a, blue);
  const h = c < 1e-6 ? 0 : ((Math.atan2(blue, a) * 180) / Math.PI + 360) % 360;
  return { l, c, h };
}

function oklchToRgbRaw({ l, c, h }: Oklch): Rgb {
  const radians = (h * Math.PI) / 180;
  const a = c * Math.cos(radians);
  const b = c * Math.sin(radians);

  const long = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const medium = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const short = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return {
    r: toGamma(4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short),
    g: toGamma(-1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short),
    b: toGamma(-0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short),
  };
}

const inGamut = ({ r, g, b }: Rgb) =>
  [r, g, b].every((channel) => channel >= -0.0001 && channel <= 1.0001);

/**
 * An OKLCH colour sRGB cannot show — most of them, at high chroma — is pulled back by dropping
 * chroma alone. Clipping the channels instead shifts the hue, which is how a chosen blue
 * arrives on screen as purple.
 */
export function oklchToRgb(colour: Oklch): Rgb {
  const raw = oklchToRgbRaw(colour);
  if (inGamut(raw)) return raw;

  let low = 0;
  let high = colour.c;
  for (let i = 0; i < 18; i++) {
    const mid = (low + high) / 2;
    if (inGamut(oklchToRgbRaw({ ...colour, c: mid }))) low = mid;
    else high = mid;
  }
  const { r, g, b } = oklchToRgbRaw({ ...colour, c: low });
  return { r: clamp(r, 0, 1), g: clamp(g, 0, 1), b: clamp(b, 0, 1) };
}

export const oklchToHex = (colour: Oklch): string => toHex(oklchToRgb(colour));
export const hexToOklch = (hex: string): Oklch => rgbToOklch(parseColor(hex) ?? BLACK);

/* ------------------------------------------------------------------ contrast */

export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrastRatio(a: Rgb | string, b: Rgb | string): number {
  const rgb = (value: Rgb | string) => (typeof value === "string" ? (parseColor(value) ?? BLACK) : value);
  const first = relativeLuminance(rgb(a));
  const second = relativeLuminance(rgb(b));
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/**
 * Black or white, whichever can be read on this colour.
 *
 * For any sRGB colour, max(contrast vs white, contrast vs black) >= 4.5, so this always returns
 * something that passes AA for body text — which is the whole reason a foreground is *derived*
 * here rather than picked by hand anywhere in the app.
 */
export function readableOn(colour: Rgb | string): string {
  return contrastRatio(colour, WHITE) >= contrastRatio(colour, BLACK) ? "#ffffff" : "#000000";
}

/**
 * The same colour, moved along OKLCH lightness until it reads against `against` at `target`,
 * and no further. Hue and chroma are kept, so a reader's blue stays their blue — it is only
 * lifted or dropped until the text on it survives.
 *
 * Contrast against a fixed ground is monotonic in lightness once the direction is chosen, and
 * the far end (black or white) clears any target up to 21, so the search always terminates.
 *
 * Every candidate is measured *after* being rounded to eight bits per channel, because that is
 * what the browser will show. Searching in float and rounding afterwards landed colours at
 * 4.48:1 against a target of 4.5 — passing the maths and failing the check that matters.
 */
export function ensureContrast(colour: Oklch, against: Rgb | string, target: number): Oklch {
  const ground = typeof against === "string" ? (parseColor(against) ?? BLACK) : against;
  const shown = (candidate: Oklch) => contrastRatio(toHex(oklchToRgb(candidate)), ground);

  if (shown(colour) >= target) return colour;

  const end = relativeLuminance(ground) > 0.18 ? 0 : 1;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 22; i++) {
    const mid = (low + high) / 2;
    if (shown({ ...colour, l: colour.l + (end - colour.l) * mid }) >= target) high = mid;
    else low = mid;
  }
  return { ...colour, l: colour.l + (end - colour.l) * high };
}

/** Rotates the hue, holding lightness and chroma — the one move that keeps contrast intact. */
export function rotateHue(hex: string, degrees: number): string {
  const colour = hexToOklch(hex);
  return oklchToHex({ ...colour, h: (((colour.h + degrees) % 360) + 360) % 360 });
}

/** The HSL hue, 0–359. Only for talking to code that still thinks in HSL. */
export function hslHue(hex: string): number {
  const { r, g, b } = parseColor(hex) ?? BLACK;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;

  const span = max - min;
  const sixth =
    max === r
      ? (g - b) / span + (g < b ? 6 : 0)
      : max === g
        ? (b - r) / span + 2
        : (r - g) / span + 4;
  return Math.round(sixth * 60) % 360;
}

/** How colourful this is, 0–0.4-ish. Used to tell a chosen grey from a chosen colour. */
export function chromaOf(hex: string): number {
  return hexToOklch(hex).c;
}
