import {
  BLACK,
  clamp,
  contrastRatio,
  ensureContrast,
  hexToOklch,
  oklchToHex,
  oklchToRgb,
  readableOn,
  WHITE,
  type Oklch,
  type Rgb,
} from "./color.ts";
import {
  artworkSeed,
  CONTRAST_TARGET,
  DEFAULT_ACCENT,
  isLightTheme,
  type ThemeState,
} from "./custom-theme.ts";

export interface Swatch {
  hue: number;
  sat: number;
}

export type Palette = Record<string, string>;

/* ---------------------------------------------------------------------------
   The ramp: one seed colour in, every surface and every text token out.

   This is the colour layer's single source of truth. It is TypeScript rather
   than a stylesheet for one reason that settles the argument: the floor under
   all of this is a *measured* WCAG ratio, and CSS cannot measure. `oklch(from
   var(--fg) …)` can push a lightness around, but it cannot ask whether the
   result still clears 4.5 against the surface it will sit on, so it cannot stop
   before it breaks. Everything here can, and does — see `accentFill` and
   `--accent-text` below. The two knob blocks globals.css used to carry (surface
   tinting and high contrast) are gone; they were dead twice over, being both
   self-referential — `--bg: oklch(from var(--bg) l 0 h)` is a custom-property
   cycle, which resolves to the property's @property initial-value, not to the
   colour you were hoping to strip — and outranked by this file, which writes
   inline on <html>. Both knobs are inputs to this function now.

   What reaches the page is sRGB hex, not `oklch()`. The gamut mapping in
   color.ts pulls an out-of-range colour back by dropping chroma, which holds
   the hue; a browser resolving `oklch()` for us would clip channels instead and
   land a chosen blue on screen as purple. Converting here also means the number
   the contrast sweep measures is the number the screen shows.
   --------------------------------------------------------------------------- */

/**
 * Where the greys stop taking more of the seed's colour.
 *
 * A seed at this chroma or above tints them as hard as they are ever tinted; below it,
 * proportionally. That proportionality is the point: it is what makes a chosen grey produce a
 * grey app instead of a cornflower-blue one, without anybody having to declare the colour
 * "neutral" first. 0.15 sits a little under a fully saturated screen colour, so an ordinary
 * bright seed reaches the top of the range and a muted one honestly does not.
 */
const TINT_FULL = 0.15;

/**
 * The least a fill may differ from the page behind it.
 *
 * Deliberately not a text bar, and deliberately not WCAG 1.4.11's 3:1 either. The label on a
 * fill gets its own derived colour, and what identifies a control here is the 2px --ink edge
 * the references draw around it, which is the thing 1.4.11 is actually about. Holding a fill
 * to 3:1 against the page is what turned a chosen peach into a mid orange. This is the much
 * lower bar below which a block of colour stops reading as a block at all — it exists so that
 * somebody who types a near-black into the picker on the dark ground still sees a button.
 */
const FILL_FLOOR = 1.5;

/**
 * The rungs: a lightness and the most chroma that rung may carry.
 *
 * The lightnesses are not adjustable and not a matter of taste — they are what 36bd71d solved
 * for when --fg-faint was failing AA in every theme, and the whole contrast floor rests on
 * them. What the seed moves is the chroma beside each one, and the accent, which has no rung.
 */
interface Rung {
  /** Perceptual lightness, 0–1. */
  l: number;
  /** The chroma this rung carries at full tint. */
  c: number;
  /** Opacity, where the token is a veil rather than a colour. */
  a?: number;
}

interface Rungs {
  bg: Rung;
  surface1: Rung;
  surface2: Rung;
  surface3: Rung;
  fg: Rung;
  dim: Rung;
  faint: Rung;
  ink: Rung;
  line: Rung;
  /** The shadow colour, and the two alphas the contact and ambient layers use. */
  drop: Rung & { far: number };
  /** How strongly the accent's own veil sits over a surface. */
  wash: number;
}

const RUNGS: Record<"dark" | "light" | "pastel", Rungs> = {
  dark: {
    bg: { l: 0.155, c: 0.017 },
    surface1: { l: 0.192, c: 0.02 },
    surface2: { l: 0.232, c: 0.022 },
    surface3: { l: 0.283, c: 0.025 },
    fg: { l: 0.965, c: 0.007 },
    dim: { l: 0.762, c: 0.01 },
    faint: { l: 0.665, c: 0.011 },
    ink: { l: 0.88, c: 0.031, a: 0.24 },
    line: { l: 0.99, c: 0.006, a: 0.09 },
    drop: { l: 0.02, c: 0, a: 0.4, far: 0.45 },
    wash: 0.16,
  },
  light: {
    // The page is a hair off white rather than white itself. At L 1 a colour has nowhere to
    // put its chroma — white is white at every hue — so a pure-white page is the one surface
    // "tint the greys" could never have changed.
    bg: { l: 0.985, c: 0.01 },
    surface1: { l: 0.974, c: 0.022 },
    surface2: { l: 0.952, c: 0.028 },
    surface3: { l: 0.922, c: 0.034 },
    fg: { l: 0.22, c: 0.031 },
    dim: { l: 0.48, c: 0.025 },
    faint: { l: 0.5, c: 0.022 },
    ink: { l: 0.22, c: 0.05, a: 1 },
    line: { l: 0.3, c: 0.037, a: 0.22 },
    drop: { l: 0.25, c: 0.037, a: 0.05, far: 0.06 },
    wash: 0.1,
  },
  // Pastel is what "colour from the album art" looks like on a light ground: white cards on a
  // tinted page, and more air between the rungs. The gentleness lives in the surfaces now —
  // the accent is the reader's colour here exactly as it is everywhere else.
  pastel: {
    bg: { l: 0.972, c: 0.031 },
    surface1: { l: 1, c: 0 },
    surface2: { l: 0.948, c: 0.037 },
    surface3: { l: 0.912, c: 0.047 },
    fg: { l: 0.26, c: 0.056 },
    dim: { l: 0.49, c: 0.031 },
    faint: { l: 0.495, c: 0.025 },
    ink: { l: 0.26, c: 0.062, a: 0.5 },
    line: { l: 0.45, c: 0.05, a: 0.12 },
    drop: { l: 0.45, c: 0.05, a: 0.06, far: 0.08 },
    wash: 0.14,
  },
};

const rgba = ({ r, g, b }: Rgb, alpha: number): string =>
  `rgb(${[r, g, b].map((channel) => Math.round(clamp(channel, 0, 1) * 255)).join(" ")} / ${alpha})`;

/** The colour on screen right now: the cover's, if a cover is what the reader asked for. */
function seedOf(swatch: Swatch | null, theme: ThemeState, light: boolean): string {
  if (theme.mode !== "custom" && swatch) {
    return artworkSeed({ h: swatch.hue / 360, s: swatch.sat }, light ? "light" : "dark");
  }
  return theme.customSeed || DEFAULT_ACCENT;
}

/**
 * The seed as a fill, moved as little as two floors allow.
 *
 * Both floors push the same way — away from the page — so the second can never undo the first.
 * The second one is free at AA: for every sRGB colour the better of black and white is at
 * least 4.54:1, so a reader on "Normal" gets the exact colour they chose, lightness, chroma
 * and all. At AAA it is not free, and that is most of what "High contrast" visibly does to the
 * accent: the fill is pushed away from the ground until the label on it clears 7:1.
 */
function accentFill(seed: Oklch, page: string, target: number, light: boolean): Oklch {
  const lifted = ensureContrast(seed, page, FILL_FLOOR);
  const shown = oklchToHex(lifted);
  if (contrastRatio(shown, readableOn(shown)) >= target) return lifted;
  return ensureContrast(lifted, light ? WHITE : BLACK, target);
}

export function buildPalette(swatch: Swatch | null, theme: ThemeState): Palette {
  const light = isLightTheme(theme);
  const seed = hexToOklch(seedOf(swatch, theme, light));
  const rungs = RUNGS[theme.mode === "pastel" ? "pastel" : light ? "light" : "dark"];

  const high = theme.contrast === "high";
  const target = CONTRAST_TARGET[theme.contrast];

  // How much of the seed's colour the greys are allowed to carry. Zero when the reader has
  // switched tinting off — which is the whole of that switch, and the reason it now moves
  // pixels for any seed rather than only for one that was already grey.
  const tint = theme.tintSurfaces ? clamp(seed.c / TINT_FULL, 0, 1) : 0;

  const tone = ({ l, c }: Rung, at = l) => oklchToHex({ l: at, c: tint * c, h: seed.h });
  const veil = ({ l, c }: Rung, alpha: number) =>
    rgba(oklchToRgb({ l, c: tint * c, h: seed.h }), alpha);

  // High contrast, which until now wrote one custom property that nothing read. The stretch is
  // the curve the dead stylesheet block asked for; the rest is the same idea applied where CSS
  // could not reach it. Every move is away from the surface behind it, so the AA floor can only
  // get further away, never closer.
  const stretch = (l: number) => (high ? clamp((l - 0.5) * 1.35 + 0.5, 0, 1) : l);
  const fgL = stretch(rungs.fg.l);
  const edge = (alpha: number) => (high ? Math.min(0.95, alpha * 1.8) : alpha);

  const bg = tone(rungs.bg);
  const surface1 = tone(rungs.surface1);

  const fill = accentFill(seed, bg, target, light);
  const accent = oklchToHex(fill);

  // --accent is a fill and --accent-text is a word, and on a light ground they cannot be the
  // same value: a pale peach that carries black beautifully is invisible as text on the page
  // behind it. Same hue, same chroma, walked in lightness until it clears the target against
  // the surface it sits on — and measured after the rounding to eight bits, because that is
  // what the browser will actually show.
  const text = oklchToHex(ensureContrast(fill, surface1, target));

  return {
    "--bg": bg,
    "--surface-1": surface1,
    "--surface-2": tone(rungs.surface2),
    "--surface-3": tone(rungs.surface3),
    "--fg": tone(rungs.fg, fgL),
    // The stylesheet's dead block said `--fg-dim: var(--fg)` in high contrast, and meant it:
    // at that setting there is no such thing as a quieter label.
    "--fg-dim": tone(rungs.dim, high ? fgL : rungs.dim.l),
    // The faint rung is the caption and track-count colour at 10–12px, so it is never exempt
    // as large text. High contrast takes it half the way to --fg rather than all of it, which
    // keeps the three tiers distinguishable while still visibly moving.
    "--fg-faint": tone(rungs.faint, high ? (rungs.faint.l + fgL) / 2 : rungs.faint.l),
    // --ink is the drawn edge around a card; --line is the quiet divider between rows. They
    // were identical once and that silently cancelled the 2px edge globals.css asks for.
    "--ink": rungs.ink.a === 1 ? tone(rungs.ink) : veil(rungs.ink, edge(rungs.ink.a ?? 1)),
    "--line": veil(rungs.line, edge(rungs.line.a ?? 1)),
    "--accent": accent,
    "--accent-fg": readableOn(accent),
    "--accent-text": text,
    "--accent-wash": rgba(oklchToRgb(fill), rungs.wash),
    // Ambient, not the hard `Npx Npx 0` offset that made every surface look like a sticker:
    // a tight contact shadow and a wide soft one, which is what reads as lifted.
    "--drop": `0 1px 2px ${veil(rungs.drop, rungs.drop.a ?? 0)}, 0 4px 14px ${veil(rungs.drop, rungs.drop.far)}`,
    "--drop-sm": `0 1px 2px ${veil(rungs.drop, (rungs.drop.a ?? 0) + 0.01)}`,
    "--drop-lg": `0 10px 32px ${veil(rungs.drop, rungs.drop.far + 0.04)}`,
  };
}
