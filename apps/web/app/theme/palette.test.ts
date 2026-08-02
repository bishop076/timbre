import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPalette, lightnessOf, type Swatch } from "./palette.ts";
import type { ThemeState } from "./theme-store.ts";

const ALBUM: ThemeState = { mode: "album", customHue: 258, customLight: false, customNeutral: false };
const PASTEL: ThemeState = { mode: "pastel", customHue: 258, customLight: false, customNeutral: false };
const CUSTOM_DARK: ThemeState = { mode: "custom", customHue: 12, customLight: false, customNeutral: false };
const CUSTOM_LIGHT: ThemeState = { mode: "custom", customHue: 12, customLight: true, customNeutral: false };

const COVER: Swatch = { hue: 190, sat: 0.55 };

/** Every hue in an `hsl(h s% l%)` palette, so a mode can be checked as a whole. */
function hues(palette: Record<string, string>): number[] {
  return Object.values(palette)
    .map((value) => /hsl\(\s*([\d.]+)/.exec(value)?.[1])
    .filter((hue): hue is string => hue !== undefined)
    .map(Number);
}

function light(palette: Record<string, string>, token: string): number {
  const value = lightnessOf(palette[token]!);
  assert.notEqual(value, null, `${token} should be an hsl() colour`);
  return value!;
}

/** The saturation percentage of one token. */
function sat(palette: Record<string, string>, token: string): number {
  return Number(/hsl\(\s*[\d.]+\s+([\d.]+)%/.exec(palette[token]!)?.[1] ?? "0");
}

test("album takes its hue from the cover", () => {
  const palette = buildPalette(COVER, ALBUM);
  // The shadow tokens are pure black at an alpha, so they carry hue 0 by
  // definition and are excluded from the "one hue" claim.
  const coloured = hues(palette).filter((hue) => hue !== 0);
  assert.deepEqual(new Set(coloured), new Set([190]), "the whole ramp is one hue");
});

test("custom ignores the cover entirely — that is the point of it", () => {
  const withCover = buildPalette(COVER, CUSTOM_DARK);
  const withNothing = buildPalette(null, CUSTOM_DARK);

  assert.deepEqual(withCover, withNothing, "artwork must not move a fixed theme");
  assert.ok(hues(withCover).includes(12), "and it uses the hue the reader chose");
  assert.ok(!hues(withCover).includes(190));
});

test("a missing swatch still yields a usable palette", () => {
  // Cross-origin artwork cannot be read, which is normal rather than
  // exceptional — the app must simply keep a sensible default.
  for (const theme of [ALBUM, PASTEL]) {
    const palette = buildPalette(null, theme);
    assert.ok(Object.keys(palette).length > 10, `${theme.mode} produced a full palette`);
    assert.ok(light(palette, "--fg") >= 0 && light(palette, "--fg") <= 100);
  }
});

test("dark grounds are dark and light grounds are light", () => {
  assert.ok(light(buildPalette(COVER, ALBUM), "--bg") < 25, "album is a dark ground");
  assert.ok(light(buildPalette(COVER, CUSTOM_DARK), "--bg") < 25);
  assert.ok(light(buildPalette(COVER, PASTEL), "--bg") > 85, "pastel is a light ground");
  assert.ok(light(buildPalette(COVER, CUSTOM_LIGHT), "--bg") > 80);
});

test("text separates from the surface it sits on, in every mode", () => {
  // The failure this guards against is a label rendered at the same lightness
  // as its background — invisible, and only noticed when the wrong album plays.
  for (const theme of [ALBUM, PASTEL, CUSTOM_DARK, CUSTOM_LIGHT]) {
    const palette = buildPalette(COVER, theme);
    const surface = light(palette, "--surface-1");
    const gap = Math.abs(light(palette, "--fg") - surface);
    assert.ok(gap > 40, `${theme.mode}: --fg is only ${gap.toFixed(0)}% from --surface-1`);

    const dimGap = Math.abs(light(palette, "--fg-dim") - surface);
    assert.ok(dimGap > 20, `${theme.mode}: --fg-dim is only ${dimGap.toFixed(0)}% from --surface-1`);
  }
});

test("accent text separates from the accent behind it", () => {
  for (const theme of [ALBUM, PASTEL, CUSTOM_DARK, CUSTOM_LIGHT]) {
    const palette = buildPalette(COVER, theme);
    const gap = Math.abs(light(palette, "--accent-fg") - light(palette, "--accent"));
    assert.ok(gap > 35, `${theme.mode}: accent-fg is only ${gap.toFixed(0)}% from accent`);
  }
});

test("surfaces step in a consistent direction", () => {
  // Dark themes get lighter as they stack; pastel gets *closer* rather than
  // darker, which is what makes it read as soft — so only the ordering that
  // each ground actually claims is asserted.
  const dark = buildPalette(COVER, ALBUM);
  assert.ok(light(dark, "--bg") < light(dark, "--surface-1"));
  assert.ok(light(dark, "--surface-1") < light(dark, "--surface-2"));
  assert.ok(light(dark, "--surface-2") < light(dark, "--surface-3"));

  const pastel = buildPalette(COVER, PASTEL);
  assert.ok(light(pastel, "--surface-1") > light(pastel, "--surface-2"));
  assert.ok(light(pastel, "--surface-2") > light(pastel, "--surface-3"));
});

test("pastel is gentler than the album ramp at the same hue", () => {
  const saturation = (value: string) => Number(/hsl\(\s*[\d.]+\s+([\d.]+)%/.exec(value)?.[1] ?? "0");
  const pastelBg = saturation(buildPalette(COVER, PASTEL)["--bg"]!);
  const albumBg = saturation(buildPalette(COVER, ALBUM)["--bg"]!);

  // A pale surface shows hue far more readily than a dark one, so matching the
  // album ramp's saturation here would produce neon, not pastel.
  assert.ok(pastelBg < albumBg, `pastel bg saturation ${pastelBg}% should be under ${albumBg}%`);
});

test("light grounds keep an edge, but a soft one", () => {
  /*
   * Two failure modes, opposite directions, and the light themes can hit
   * either.
   *
   * Too pale and the border vanishes into the plane — an app of floating text
   * with no structure. Too dark and it is the *dark* ramp's near-black outline
   * drawn around every panel on a bright surface, which is what made the light
   * themes look harsh rather than bright. The edge has to live in between.
   */
  for (const theme of [PASTEL, CUSTOM_LIGHT]) {
    const palette = buildPalette(COVER, theme);
    const ink = light(palette, "--ink");
    const surface = light(palette, "--surface-1");

    assert.ok(ink > 30, `${theme.mode}: --ink at ${ink}% is the dark ramp's harsh edge`);
    assert.ok(surface - ink > 25, `${theme.mode}: --ink at ${ink}% would vanish into the plane`);
  }
});

test("light grounds cast a short, translucent shadow", () => {
  /*
   * Two properties, and softening only one of them is not enough.
   *
   * A solid shadow sits directly behind the border and doubles the apparent
   * weight of the edge. But the *offset* is a distance, and on a pale ground
   * the eye reads that gap as a second edge however faint it is — so the throw
   * has to shorten too, or the outline survives the colour change.
   */
  for (const theme of [PASTEL, CUSTOM_LIGHT]) {
    const palette = buildPalette(COVER, theme);
    const drop = palette["--drop"]!;

    assert.match(drop, /\/\s*0?\.\d+\s*\)/, `${theme.mode}: --drop needs an alpha, got ${drop}`);

    const offset = Number(/^(\d+)px/.exec(drop)?.[1]);
    assert.ok(offset <= 1, `${theme.mode}: --drop travels ${offset}px, which reads as an outline`);

    const alpha = Number(/\/\s*(0?\.\d+)\s*\)/.exec(drop)?.[1]);
    assert.ok(alpha <= 0.2, `${theme.mode}: --drop at ${alpha} opacity is still heavy`);
  }
});

test("the dark ground keeps its longer, solid throw", () => {
  // The shortening above is a light-ground fix. Between two nearly-black planes
  // the offset is the only thing saying one sits on the other.
  const drop = buildPalette(COVER, ALBUM)["--drop"]!;
  assert.ok(Number(/^(\d+)px/.exec(drop)?.[1]) >= 3, `dark --drop should keep its depth: ${drop}`);
});

test("the dark ground keeps its hard edge", () => {
  // The softening above is for light grounds only. Over near-black there is
  // barely any contrast to spend, and the solid edge is what makes a panel
  // legible as an object at all.
  const palette = buildPalette(COVER, ALBUM);
  assert.ok(light(palette, "--ink") < 10, "dark ink stays near-black");
  assert.ok(light(palette, "--ink") < light(palette, "--surface-1"));
});

test("an extreme swatch is pulled back into a usable range", () => {
  // A fully saturated cover would otherwise vibrate, and a washed-out one would
  // produce a palette with no colour at all.
  const neon = buildPalette({ hue: 300, sat: 1 }, ALBUM);
  const washed = buildPalette({ hue: 300, sat: 0 }, ALBUM);

  assert.ok(sat(neon, "--bg") <= 30, "clamped down from full saturation");
  assert.ok(sat(washed, "--bg") > 5, "and still carries some hue rather than going grey");
});

test("surfaces carry far less hue than the accent", () => {
  // The reason the first version of this ramp was tiring: a strong cover made
  // the ground, the panels *and* the labels the same loud colour, so the eye
  // had nowhere to rest and the artwork competed with its own backdrop. The
  // colour belongs in the accent; the surfaces only hint at it.
  const palette = buildPalette({ hue: 300, sat: 0.7 }, ALBUM);

  assert.ok(
    sat(palette, "--bg") < sat(palette, "--accent") / 2,
    `--bg at ${sat(palette, "--bg")}% should be well under the accent's ${sat(palette, "--accent")}%`,
  );
  assert.ok(sat(palette, "--fg") < 12, "labels are near-neutral, not tinted");
});

test("the album ground is genuinely dark", () => {
  const palette = buildPalette({ hue: 300, sat: 0.7 }, ALBUM);
  assert.ok(light(palette, "--bg") <= 10, `--bg at ${light(palette, "--bg")}% is not dark enough`);
});

test("neutral has no colour, on either ground", () => {
  for (const isLight of [true, false]) {
    const palette = buildPalette(COVER, {
      mode: "custom",
      customHue: 200,
      customLight: isLight,
      customNeutral: true,
    });

    for (const token of ["--bg", "--surface-1", "--fg", "--accent"]) {
      assert.ok(
        sat(palette, token) <= 5,
        `${token} at ${sat(palette, token)}% is not neutral on a ${isLight ? "light" : "dark"} ground`,
      );
    }
  }
});

test("neutral still reads as white or as dark", () => {
  const base = { mode: "custom" as const, customHue: 200, customNeutral: true };
  const white = buildPalette(COVER, { ...base, customLight: true });
  const dark = buildPalette(COVER, { ...base, customLight: false });

  assert.ok(light(white, "--bg") > 85, "white is white");
  assert.ok(light(dark, "--bg") < 15, "dark is dark");
  // Still legible, which is the thing a colourless palette most easily loses.
  assert.ok(Math.abs(light(white, "--fg") - light(white, "--surface-1")) > 40);
  assert.ok(Math.abs(light(dark, "--fg") - light(dark, "--surface-1")) > 40);
});

test("a neutral choice ignores the artwork completely", () => {
  const neutral = { mode: "custom" as const, customHue: 200, customLight: false, customNeutral: true };
  assert.deepEqual(buildPalette({ hue: 12, sat: 0.9 }, neutral), buildPalette(null, neutral));
});

test("custom hue wraps rather than producing an invalid colour", () => {
  const palette = buildPalette(null, { mode: "custom", customHue: 359, customLight: false, customNeutral: false });
  for (const hue of hues(palette)) {
    assert.ok(hue >= 0 && hue < 360, `hue ${hue} is out of range`);
  }
});
