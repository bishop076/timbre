import { isLightTheme, type ThemeState } from "./theme-store.ts";

/**
 * The whole interface, as one tonal ramp.
 *
 * Every surface, line and label is a step on a single hue, so the app reads as
 * one tinted material rather than grey chrome with a coloured button in it.
 * Neutral greys are deliberately absent: a "grey" here is the same hue at very
 * low saturation, which is what stops the tint looking bolted on.
 *
 * Pure and separated from the effect that applies it, because this is where the
 * bugs live — a ramp that puts a label at the same lightness as the surface
 * behind it is invisible, and that is far easier to catch in a test than by
 * staring at a running app and waiting for the wrong album to play.
 *
 * Hue and saturation come from three different places depending on the mode,
 * which is the entire difference between the themes:
 *
 * | mode      | hue           | ground | character                        |
 * | --------- | ------------- | ------ | -------------------------------- |
 * | `album`   | current cover | dark   | dim; the cover lights the room   |
 * | `pastel`  | current cover | light  | soft, held high and pale         |
 * | `custom`  | the reader's  | either | fixed; artwork never moves it    |
 * | ⌞ neutral | none          | either | plain white or plain dark        |
 *
 * The colour always lands in the **accent**. Surfaces take only `SURFACE_TINT`
 * of it, which is what keeps the artwork the most colourful thing on screen
 * instead of making it compete with a background painted the same shade.
 */

/** A colour read from artwork. Hue in degrees, saturation 0–1. */
export interface Swatch {
  hue: number;
  sat: number;
}

export type Palette = Record<string, string>;

/** Fallback hues for "nothing playing", per ground. */
const FALLBACK_HUE = { dark: 258, light: 262 };

/**
 * Custom mode's saturation.
 *
 * Fixed rather than taken from the artwork, because the point of the mode is
 * that nothing about it moves. Mid-range: high enough that the chosen hue is
 * unmistakable, low enough that a full-saturation red does not vibrate.
 */
const CUSTOM_SAT = 0.62;

/**
 * Neutral's saturation — not quite zero.
 *
 * A trace of hue keeps the greys from looking like a screenshot of a different
 * app pasted in. At 4% it is not perceptible as colour, only as warmth.
 */
const NEUTRAL_SAT = 0.04;

/**
 * How much of the hue reaches the *surfaces*, as a fraction of the accent's.
 *
 * The single number that decides whether the app reads as tinted or as stained.
 * It began at ~0.85 and the result was genuinely tiring: a saturated cover
 * turned every plane, every label and the page ground itself into that colour,
 * so there was nowhere for the eye to rest and the artwork — the one thing that
 * should be the most colourful object on screen — had to compete with its own
 * background.
 *
 * At 0.34 the hue is still unmistakable on every surface, but the interface is
 * a dark room lit by the album rather than a room painted in it. The accent
 * keeps its full saturation, so the colour still arrives where it is meant to.
 */
const SURFACE_TINT = 0.34;

function hsl(hue: number, sat: number, light: number): string {
  return `hsl(${Math.round(hue)} ${Math.round(sat * 100)}% ${Math.round(light * 100)}%)`;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function buildPalette(swatch: Swatch | null, theme: ThemeState): Palette {
  const light = isLightTheme(theme);
  const custom = theme.mode === "custom";
  const neutral = custom && theme.customNeutral;

  const hue = custom
    ? theme.customHue
    : (swatch?.hue ?? (light ? FALLBACK_HUE.light : FALLBACK_HUE.dark));

  // Saturation drives how strongly the hue reads. Surfaces stay well below the
  // accent so the artwork remains the most colourful thing on screen.
  const sat = neutral
    ? NEUTRAL_SAT
    : custom
      ? CUSTOM_SAT
      : swatch
        ? clamp(swatch.sat, 0.3, 0.7)
        : 0.5;

  const tone = (l: number, s = sat) => hsl(hue, s, l);

  /*
   * The accent's saturation, floored so a washed-out cover still yields a
   * usable accent rather than a grey button.
   *
   * Neutral bypasses the floor entirely. It is the one case where colourless is
   * the answer rather than a failure to find a colour — and a floor cannot tell
   * those apart, so it would quietly reinstate the tint the reader just asked
   * to remove.
   */
  const accentSat = (low: number, high: number) => (neutral ? sat : clamp(sat, low, high));

  if (theme.mode === "pastel") {
    /*
     * Pastel is not "light mode with the same numbers".
     *
     * Lightness sits high and the gaps between surfaces are small, so planes
     * separate by a few percent rather than by contrast — that closeness is
     * what makes a palette read as soft. Saturation is pulled right down
     * because a pale surface shows hue far more readily than a dark one: the
     * album ramp's saturation on a 96%-light background is not gentle, it is
     * neon.
     *
     * The ink stays a real edge rather than going pale with everything else.
     * The hard border is the interface's structure, and a pastel app with no
     * edges is not softer, it is mush.
     */
    return {
      "--bg": tone(0.96, sat * 0.3),
      "--surface-1": tone(0.99, sat * 0.18),
      "--surface-2": tone(0.93, sat * 0.34),
      "--surface-3": tone(0.87, sat * 0.4),
      "--fg": tone(0.22, sat * 0.5),
      "--fg-dim": tone(0.45, sat * 0.32),
      "--fg-faint": tone(0.62, sat * 0.28),
      "--ink": tone(0.44, sat * 0.34),
      "--line": tone(0.85, sat * 0.3),
      "--accent": tone(0.7, accentSat(0.45, 0.62)),
      "--accent-fg": tone(0.18, sat * 0.5),
      "--accent-wash": `hsl(${Math.round(hue)} ${Math.round(sat * 70)}% 72% / 0.28)`,
      // Short and faint, like the other light ground. The offset is a distance
      // the eye reads as a second edge, so on a pale surface it has to be
      // small — softening the colour alone leaves the outline behind.
      "--drop": `1px 1px 0 hsl(${Math.round(hue)} ${Math.round(sat * 34)}% 44% / 0.14)`,
      "--drop-sm": `1px 1px 0 hsl(${Math.round(hue)} ${Math.round(sat * 34)}% 44% / 0.14)`,
      "--drop-lg": `2px 2px 0 hsl(${Math.round(hue)} ${Math.round(sat * 34)}% 44% / 0.14)`,
    };
  }

  if (light) {
    /*
     * Custom on a light ground.
     *
     * The ink is a soft tinted grey, **not** the near-black the dark ramp uses.
     * A 2px near-black border plus a hard black offset shadow reads as depth
     * over a dark ground, where there is barely any contrast to spend; over a
     * pale surface the identical values read as a heavy outline drawn around
     * every panel, tile and button — which is what made the light themes look
     * harsh rather than bright.
     *
     * The shadow is also translucent here. Solid, it competes with the border
     * it sits behind and doubles the apparent weight of the edge; at a third
     * opacity it still lifts the panel without adding a second hard line.
     */
    const ink = tone(0.44, sat * 0.26);
    /*
     * Shorter as well as fainter.
     *
     * Softening the colour alone was not enough: a 3px offset is a *distance*,
     * and on a pale ground the eye reads that gap as a second edge no matter
     * how light it is. Halving the travel is what turns it from a drawn outline
     * into a lift. Dark keeps the longer throw, where the same offset is the
     * only thing separating two nearly-black planes.
     */
    const shade = (offset: string) =>
      `${offset} hsl(${Math.round(hue)} ${Math.round(sat * 26)}% 44% / 0.16)`;

    return {
      "--bg": tone(0.9, sat * 0.4),
      "--surface-1": tone(0.96, sat * 0.28),
      "--surface-2": tone(0.88, sat * 0.4),
      "--surface-3": tone(0.8, sat * 0.45),
      "--fg": tone(0.16, sat * 0.4),
      "--fg-dim": tone(0.4, sat * 0.3),
      "--fg-faint": tone(0.56, sat * 0.28),
      "--ink": ink,
      // Dividers must be lighter than borders. Sharing one value made every
      // rule between two rows as heavy as the outline around the panel.
      "--line": tone(0.84, sat * 0.3),
      // A colourless accent has to earn its contrast from lightness alone, so
      // white's goes near-black rather than sitting at the mid grey a coloured
      // accent can afford. It also simply looks deliberate — monochrome — where
      // a grey button reads as an unstyled one.
      "--accent": tone(neutral ? 0.24 : 0.56, accentSat(0.6, 0.85)),
      "--accent-fg": tone(0.98, sat * 0.2),
      "--accent-wash": `hsl(${Math.round(hue)} ${Math.round(sat * 100)}% 62% / 0.14)`,
      "--drop": shade("1px 1px 0"),
      "--drop-sm": shade("1px 1px 0"),
      "--drop-lg": shade("2px 2px 0"),
    };
  }

  /*
   * Dark — `album`, and `custom` on a dark ground.
   *
   * Deliberately *dim*. The planes sit low on the lightness scale and carry
   * only `SURFACE_TINT` of the hue, so the room is dark and the album lights it
   * rather than painting it. The accent keeps full saturation: that is where
   * the colour is supposed to arrive, and holding it there is what lets
   * everything else recede.
   *
   * The earlier version put near-full saturation on every plane and was tiring
   * to look at — with a strong cover the ground, the panels and the labels were
   * all the same loud colour, leaving the eye nowhere to rest and forcing the
   * artwork to compete with its own backdrop.
   */
  const surfaceSat = sat * SURFACE_TINT;
  const shadow = "hsl(0 0% 0% / 0.85)";
  return {
    "--bg": tone(0.07, surfaceSat),
    "--surface-1": tone(0.11, surfaceSat),
    "--surface-2": tone(0.16, surfaceSat * 0.95),
    "--surface-3": tone(0.22, surfaceSat * 0.9),
    // Labels are near-neutral. Tinted text on a tinted plane is what made the
    // old ramp read as a colour cast over the whole app rather than as a theme.
    "--fg": tone(0.95, sat * 0.14),
    "--fg-dim": tone(0.73, sat * 0.12),
    "--fg-faint": tone(0.55, sat * 0.12),
    // The hard edge has to be *lighter* than the plane it outlines on a dark
    // ground. Black-on-black is the whole look made invisible.
    "--ink": tone(0.03, surfaceSat),
    "--line": tone(0.26, surfaceSat),
    "--accent": tone(0.7, accentSat(0.6, 0.9)),
    "--accent-fg": tone(0.08, sat * 0.5),
    // Halved: this is the glow behind the content panel, and at 0.2 it was a
    // second full-strength wash of the same hue sitting under everything.
    "--accent-wash": `hsl(${Math.round(hue)} ${Math.round(sat * 100)}% 55% / 0.1)`,
    "--drop": `3px 3px 0 ${shadow}`,
    "--drop-sm": `2px 2px 0 ${shadow}`,
    "--drop-lg": `5px 5px 0 ${shadow}`,
  };
}

/** Parses the lightness percentage back out of an `hsl(...)` string. */
export function lightnessOf(color: string): number | null {
  const match = /hsl\(\s*[\d.]+\s+[\d.]+%\s+([\d.]+)%/.exec(color);
  return match ? Number(match[1]) : null;
}
