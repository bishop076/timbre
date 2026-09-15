/**
 * What "a theme" is here, now that it is no longer three hardcoded templates.
 *
 * The reader chooses one seed colour and a handful of orthogonal switches; everything visible
 * is derived from those. The ramp itself is built elsewhere (palette.ts) — this module's job is
 * to hold the choice, validate it on the way in from storage, and answer two questions for
 * whoever paints: *which colour, right now*, and *what is readable on it*.
 *
 * Pure, so the whole of it is testable under `node --test`.
 */

import {
  chromaOf,
  clamp,
  contrastRatio,
  ensureContrast,
  hexToOklch,
  hslHue,
  normaliseHex,
  oklchToHex,
  readableOn,
  rotateHue,
} from "./color.ts";
import { cleanFamily, isFontId, type FontId } from "./fonts.ts";

/** The legacy view. palette.ts still consumes exactly this, and is free to stop. */
export interface ThemeState {
  mode: "album" | "pastel" | "custom";
  customHue: number;
  customLight: boolean;
  customNeutral: boolean;
}

export type Ground = "system" | "light" | "dark";
export type AccentSource = "artwork" | "fixed" | "cycle";
export type Contrast = "normal" | "high";
export type BackgroundFit = "cover" | "contain" | "tile";

export interface BackgroundPrefs {
  fit: BackgroundFit;
  /** How hard the scrim sits over the picture, 0.3–0.92. Never zero — see `clampDim`. */
  dim: number;
  /** Blur in px, 0–40. A blurred picture competes with text far less. */
  blur: number;
}

export interface FontChoice {
  id: FontId;
  /** The family name of an uploaded font; empty for every built-in choice. */
  family: string;
}

export interface Theme extends ThemeState {
  ground: Ground;
  accentSource: AccentSource;
  /** The seed, #rrggbb. Everything colourful is derived from this one value. */
  accent: string;
  contrast: Contrast;
  /** Whether the seed tints the greys too, or only the accent itself. */
  tintSurfaces: boolean;
  /** Root font size multiplier, 0.85–1.5. */
  textScale: number;
  background: BackgroundPrefs;
  font: FontChoice;
}

/* ------------------------------------------------------------------ the banner */

/**
 * Read off the Timbre banner: night sky into violet into lilac, a peach sun, and the cream the
 * wordmark sits in. The default accent is the middle violet, which is also what globals.css and
 * the link-card theme colour already carry.
 */
export const BANNER = {
  sky: "#2a1a5c",
  violet: "#5b3fd6",
  lilac: "#8f74ff",
  sun: "#ffd9a8",
  sea: "#1b1140",
  cream: "#f3efe4",
} as const;

export const DEFAULT_ACCENT = BANNER.violet;

/** The grounds contrast is measured against. Mirrors --bg in globals.css for each theme. */
export const GROUND = { light: "#eef0f6", dark: "#08080a" } as const;

/** Offered as one-tap starting points. Any colour at all is reachable past these. */
export const PRESETS: { name: string; hex: string }[] = [
  { name: "Timbre violet", hex: BANNER.violet },
  { name: "Lilac", hex: BANNER.lilac },
  { name: "Midnight", hex: BANNER.sky },
  { name: "Peach", hex: BANNER.sun },
  { name: "Cream", hex: BANNER.cream },
  { name: "Rose", hex: "#e2476d" },
  { name: "Ember", hex: "#e06c2a" },
  { name: "Moss", hex: "#3f9d5a" },
  { name: "Teal", hex: "#1f9e9a" },
  { name: "Ocean", hex: "#2f6fe0" },
  { name: "Slate", hex: "#6b7280" },
  { name: "Graphite", hex: "#8a8a93" },
];

/**
 * 0.6, not a rounder-looking 0.55, because the app has to ship a default that passes its own
 * check: at 0.55 a white pixel under the scrim on the dark ground leaves body text at 4.3:1,
 * and the picker would greet every new picture with its own readability warning.
 */
export const DEFAULT_BACKGROUND: BackgroundPrefs = { fit: "cover", dim: 0.6, blur: 8 };

export const DEFAULT_THEME: Theme = {
  ground: "dark",
  accentSource: "artwork",
  accent: DEFAULT_ACCENT,
  contrast: "normal",
  tintSurfaces: true,
  textScale: 1,
  background: DEFAULT_BACKGROUND,
  font: { id: "default", family: "" },

  // The legacy mirror, kept in the same object so nothing that reads a ThemeState has to know
  // any of the above exists. `legacyMirror` recomputes these on every save.
  mode: "album",
  customHue: hslHue(DEFAULT_ACCENT),
  customLight: false,
  customNeutral: false,
};

/* ------------------------------------------------------------------ accessibility floors */

/** AA for body text; AAA at the reader's request. Everything derived is held to this. */
export const CONTRAST_TARGET: Record<Contrast, number> = { normal: 4.5, high: 7 };

/**
 * The floor under the background-image scrim. A picture behind text is the one customisation
 * that can destroy legibility outright — a light photo under white text is unreadable at any
 * accent — so the dimming that protects the text is not something the reader can switch off,
 * only choose the strength of.
 */
export const MIN_DIM = 0.3;
export const MAX_DIM = 0.92;

export const clampDim = (value: number) => clamp(value, MIN_DIM, MAX_DIM);
export const clampBlur = (value: number) => clamp(Math.round(value), 0, 40);
export const clampScale = (value: number) => clamp(Math.round(value * 100) / 100, 0.85, 1.5);

/** A seed is "a grey" when it has almost no chroma — that is what neutral means now. */
export const isNeutralSeed = (hex: string) => chromaOf(hex) < 0.025;

/* ------------------------------------------------------------------ deriving */

export const resolveGround = (theme: Theme, systemDark: boolean): "light" | "dark" =>
  theme.ground === "system" ? (systemDark ? "dark" : "light") : theme.ground;

/**
 * The reader's seed, corrected until it can actually be seen on the ground it will sit on.
 *
 * This is the fix for the old ramp's real bug: it authored --accent and --accent-fg from
 * separate formulas and hoped. Here the accent is moved in lightness until it clears the
 * target against the ground, and the foreground on it is then *derived* from the result.
 */
export function accentFor(seed: string, ground: "light" | "dark", contrast: Contrast): string {
  const target = CONTRAST_TARGET[contrast];
  return oklchToHex(ensureContrast(hexToOklch(seed), GROUND[ground], target));
}

/** Black or white on the accent — whichever is legible. Never authored by hand. */
export const accentForeground = (accent: string) => readableOn(accent);

/** How long one colour is held before it drifts to the next, in "cycle". */
export const CYCLE_STEP_MS = 45_000;

/**
 * Degrees per step. Coprime with 360, so the walk visits 360 distinct hues before it repeats
 * and never lands back on the starting colour early — a cycle that returns after six steps
 * reads as a loop, not as drift.
 */
export const CYCLE_TURN = 37;

/**
 * The live seed at a given moment.
 *
 * "cycle" is derived from the wall clock rather than a stored counter: any tab, any reload,
 * any pre-paint replay computes the same colour for the same instant, so nothing has to be
 * persisted as it drifts and two tabs never disagree.
 */
export function seedAt(theme: Theme, now: number, artwork?: string | null): string {
  if (theme.accentSource === "artwork") return artwork ?? theme.accent;
  if (theme.accentSource === "cycle") {
    return rotateHue(theme.accent, Math.floor(now / CYCLE_STEP_MS) * CYCLE_TURN);
  }
  return theme.accent;
}

/** When the cycle next moves, so a timer can sleep exactly that long. */
export const msToNextStep = (now: number) => CYCLE_STEP_MS - (now % CYCLE_STEP_MS);

/** A cover's dominant hue and saturation, turned into a seed. */
export function artworkSeed({ h, s }: { h: number; s: number }, ground: "light" | "dark"): string {
  const chroma = clamp(s, 0.18, 0.72) * 0.22;
  const lightness = ground === "light" ? 0.52 : 0.68;
  return oklchToHex({ l: lightness, c: chroma, h: ((h * 360) % 360 + 360) % 360 });
}

/**
 * The four fields palette.ts reads, recomputed from the seed. Keeping them inside the stored
 * object is what lets the ramp, the pre-paint script and the artwork sampler all carry on
 * working untouched while the layer above them is replaced.
 */
export function legacyMirror(theme: Theme, seed: string, light: boolean): ThemeState {
  return {
    mode: theme.accentSource === "artwork" ? (light ? "pastel" : "album") : "custom",
    customHue: hslHue(seed),
    customLight: light,
    customNeutral: !theme.tintSurfaces && isNeutralSeed(seed),
  };
}

/* ------------------------------------------------------------------ validation */

const one = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

const GROUNDS = ["system", "light", "dark"] as const;
const SOURCES = ["artwork", "fixed", "cycle"] as const;
const CONTRASTS = ["normal", "high"] as const;
const FITS = ["cover", "contain", "tile"] as const;

const number = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/**
 * What comes back out of localStorage: the shape of a Theme and the types of nothing at all.
 * Every field is `unknown` on purpose — this is a reader-editable file, and typing it as a
 * `Partial<Theme>` would be a claim about it that nothing has checked yet.
 */
interface StoredTheme {
  mode?: unknown;
  customHue?: unknown;
  customLight?: unknown;
  customNeutral?: unknown;
  ground?: unknown;
  accentSource?: unknown;
  accent?: unknown;
  contrast?: unknown;
  tintSurfaces?: unknown;
  textScale?: unknown;
  background?: { fit?: unknown; dim?: unknown; blur?: unknown };
  font?: { id?: unknown; family?: unknown };
}

/**
 * Everything that comes back out of storage, including the shape this replaced. A reader who
 * had "pastel" keeps a light ground; a reader who had a custom hue keeps that colour.
 */
export function parseTheme(stored: unknown): Theme {
  if (!stored || typeof stored !== "object") return DEFAULT_THEME;
  const value = stored as StoredTheme;

  const legacy = legacyDefaults(value);
  const accent = (typeof value.accent === "string" && normaliseHex(value.accent)) || legacy.accent;
  const background = value.background ?? {};
  const font = value.font ?? {};
  const id = isFontId(font.id) ? font.id : "default";

  return withMirror({
    ...DEFAULT_THEME,
    ground: one(value.ground, GROUNDS, legacy.ground),
    accentSource: one(value.accentSource, SOURCES, legacy.accentSource),
    accent,
    contrast: one(value.contrast, CONTRASTS, "normal"),
    tintSurfaces: typeof value.tintSurfaces === "boolean" ? value.tintSurfaces : legacy.tintSurfaces,
    textScale: clampScale(number(value.textScale, 1)),
    background: {
      fit: one(background.fit, FITS, DEFAULT_BACKGROUND.fit),
      dim: clampDim(number(background.dim, DEFAULT_BACKGROUND.dim)),
      blur: clampBlur(number(background.blur, DEFAULT_BACKGROUND.blur)),
    },
    font: { id, family: id === "custom" ? cleanFamily(String(font.family ?? "")) : "" },
  });
}

/** What the three old template modes become, for a reader who saved one before this landed. */
function legacyDefaults(value: StoredTheme): {
  ground: Ground;
  accentSource: AccentSource;
  accent: string;
  tintSurfaces: boolean;
} {
  const mode = value.mode;
  if (mode !== "album" && mode !== "pastel" && mode !== "custom") {
    return {
      ground: DEFAULT_THEME.ground,
      accentSource: DEFAULT_THEME.accentSource,
      accent: DEFAULT_ACCENT,
      tintSurfaces: true,
    };
  }

  const light = mode === "pastel" || (mode === "custom" && value.customLight === true);
  const hue = number(value.customHue, hslHue(DEFAULT_ACCENT));
  const neutral = mode === "custom" && value.customNeutral === true;

  // Rebuilt through HSL, not OKLCH: what was stored is an HSL hue, and the two wheels do not
  // line up — OKLCH 120° is a yellow-green where HSL 120° is the green the reader picked.
  const wheel = ((hue % 360) + 360) % 360;
  return {
    ground: light ? "light" : "dark",
    accentSource: mode === "custom" ? "fixed" : "artwork",
    accent: neutral ? "#8a8a93" : (normaliseHex(`hsl(${wheel} 62% ${light ? 52 : 62}%)`) ?? DEFAULT_ACCENT),
    tintSurfaces: !neutral,
  };
}

/** Recomputes the legacy mirror. Every write goes through here, so the two cannot drift. */
export function withMirror(theme: Theme, systemDark = theme.ground !== "light"): Theme {
  const light = resolveGround(theme, systemDark) === "light";
  return { ...theme, ...legacyMirror(theme, seedAt(theme, Date.now()), light) };
}

/* ------------------------------------------------------------------ what gets painted */

/**
 * The custom properties this layer owns. Deliberately none of the ramp's own tokens: the
 * artwork sampler writes those inline on the same element, and two writers on one property is
 * a race nobody can debug. The ramp reads --accent-seed and derives the rest.
 */
export function themeVars(theme: Theme, seed: string, light: boolean): Record<string, string> {
  const accent = accentFor(seed, light ? "light" : "dark", theme.contrast);
  return {
    "--accent-seed": accent,
    "--accent-seed-fg": accentForeground(accent),
    "--ui-scale": String(theme.textScale),
  };
}

/**
 * The background picture's variables. The scrim is the ground colour, not black: dimming a
 * light theme towards black leaves dark text on a mid-grey, which is worse than either end.
 */
export function backgroundVars(background: BackgroundPrefs, light: boolean): Record<string, string> {
  const dim = clampDim(background.dim);
  return {
    "--app-bg-size": background.fit === "tile" ? "auto" : background.fit,
    "--app-bg-repeat": background.fit === "tile" ? "repeat" : "no-repeat",
    "--app-bg-dim": String(dim),
    "--app-bg-blur": `${clampBlur(background.blur)}px`,
    "--app-bg-scrim": light ? GROUND.light : GROUND.dark,
  };
}

/**
 * Whether body text still clears AA over the dimmed picture, at the worst case: the scrim over
 * pure white, and over pure black. Used to tell the reader when their dimming is too light,
 * rather than letting them discover it by not being able to read anything.
 */
export function scrimIsReadable(dim: number, light: boolean, foreground: string): boolean {
  const scrim = light ? GROUND.light : GROUND.dark;
  const worst = light ? "#000000" : "#ffffff";
  const blended = mix(worst, scrim, clampDim(dim));
  return contrastRatio(blended, foreground) >= 4.5;
}

/** Simple sRGB mix, matching what compositing a translucent scrim actually does. */
export function mix(under: string, over: string, amount: number): string {
  const parse = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  const [r1, g1, b1] = parse(under);
  const [r2, g2, b2] = parse(over);
  const blend = (x: number, y: number) =>
    Math.round(x + (y - x) * clamp(amount, 0, 1))
      .toString(16)
      .padStart(2, "0");
  return `#${blend(r1, r2)}${blend(g1, g2)}${blend(b1, b2)}`;
}
