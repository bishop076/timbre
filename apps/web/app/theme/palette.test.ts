import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPalette, type Palette, type Swatch } from "./palette.ts";
import type { ThemeState } from "./theme-store.ts";

const ALBUM: ThemeState = { mode: "album", customHue: 258, customLight: false, customNeutral: false };
const PASTEL: ThemeState = { ...ALBUM, mode: "pastel" };
const CUSTOM_DARK: ThemeState = { ...ALBUM, mode: "custom", customHue: 12 };
const CUSTOM_LIGHT: ThemeState = { ...CUSTOM_DARK, customLight: true };
const NEUTRAL_DARK: ThemeState = { ...ALBUM, mode: "custom", customHue: 200, customNeutral: true };
const NEUTRAL_LIGHT: ThemeState = { ...NEUTRAL_DARK, customLight: true };
const ALL = [ALBUM, PASTEL, CUSTOM_DARK, CUSTOM_LIGHT, NEUTRAL_DARK, NEUTRAL_LIGHT];

const COVER: Swatch = { hue: 190, sat: 0.55 };
const VIVID: Swatch = { hue: 300, sat: 0.7 };

function hues(palette: Palette): number[] {
  return Object.values(palette).flatMap((value) => {
    const hue = /hsl\(\s*([\d.]+)/.exec(value)?.[1];
    return hue === undefined ? [] : [Number(hue)];
  });
}

function channel(palette: Palette, token: string, index: 1 | 2): number {
  const match = /hsl\(\s*[\d.]+\s+([\d.]+)%\s+([\d.]+)%/.exec(palette[token]);
  assert.ok(match, `${token} should be an hsl() colour`);
  return Number(match[index]);
}

const sat = (palette: Palette, token: string) => channel(palette, token, 1);
const light = (palette: Palette, token: string) => channel(palette, token, 2);
const gap = (palette: Palette, a: string, b: string) => Math.abs(light(palette, a) - light(palette, b));

test("album takes its hue from the cover", () => {
  const coloured = hues(buildPalette(COVER, ALBUM)).filter((hue) => hue !== 0);
  assert.deepEqual(new Set(coloured), new Set([190]), "the whole ramp is one hue");
});

test("custom and neutral ignore the cover entirely", () => {
  for (const theme of [CUSTOM_DARK, NEUTRAL_DARK]) {
    assert.deepEqual(buildPalette({ hue: 12, sat: 0.9 }, theme), buildPalette(null, theme));
    assert.deepEqual(buildPalette(COVER, theme), buildPalette(null, theme));
  }
  assert.ok(hues(buildPalette(COVER, CUSTOM_DARK)).includes(12), "custom uses the chosen hue");
  assert.ok(!hues(buildPalette(COVER, CUSTOM_DARK)).includes(190));
});

test("a missing swatch still yields a usable palette", () => {
  for (const theme of [ALBUM, PASTEL]) {
    const palette = buildPalette(null, theme);
    assert.ok(Object.keys(palette).length > 10, `${theme.mode} produced a full palette`);
    assert.ok(light(palette, "--fg") >= 0 && light(palette, "--fg") <= 100);
  }
});

test("dark grounds are dark and light grounds are light", () => {
  const cases: [ThemeState, number, number][] = [
    [ALBUM, 0, 25],
    [CUSTOM_DARK, 0, 25],
    [NEUTRAL_DARK, 0, 15],
    [PASTEL, 85, 100],
    [CUSTOM_LIGHT, 80, 100],
    [NEUTRAL_LIGHT, 85, 100],
  ];
  for (const [theme, low, high] of cases) {
    const bg = light(buildPalette(COVER, theme), "--bg");
    assert.ok(bg > low && bg < high, `${theme.mode}: --bg at ${bg}% is outside ${low}–${high}%`);
  }
  assert.ok(light(buildPalette(VIVID, ALBUM), "--bg") <= 10, "the album ground is genuinely dark");
});

test("text and accent text separate from what they sit on, in every mode", () => {
  for (const theme of ALL) {
    const palette = buildPalette(COVER, theme);
    assert.ok(gap(palette, "--fg", "--surface-1") > 40, `${theme.mode}: --fg too close to surface`);
    assert.ok(gap(palette, "--fg-dim", "--surface-1") > 20, `${theme.mode}: --fg-dim too close`);
    assert.ok(gap(palette, "--accent-fg", "--accent") > 35, `${theme.mode}: accent-fg too close`);
  }
});

test("surfaces step in a consistent direction", () => {
  const dark = buildPalette(COVER, ALBUM);
  assert.ok(light(dark, "--bg") < light(dark, "--surface-1"));
  assert.ok(light(dark, "--surface-1") < light(dark, "--surface-2"));
  assert.ok(light(dark, "--surface-2") < light(dark, "--surface-3"));

  const pastel = buildPalette(COVER, PASTEL);
  assert.ok(light(pastel, "--surface-1") > light(pastel, "--surface-2"));
  assert.ok(light(pastel, "--surface-2") > light(pastel, "--surface-3"));
});

test("pastel is gentler than the album ramp at the same hue", () => {
  const pastelBg = sat(buildPalette(COVER, PASTEL), "--bg");
  const albumBg = sat(buildPalette(COVER, ALBUM), "--bg");
  assert.ok(pastelBg < albumBg, `pastel bg saturation ${pastelBg}% should be under ${albumBg}%`);
});

test("light grounds keep a soft edge and a short, translucent shadow", () => {
  for (const theme of [PASTEL, CUSTOM_LIGHT]) {
    const palette = buildPalette(COVER, theme);
    const ink = light(palette, "--ink");
    assert.ok(ink > 30, `${theme.mode}: --ink at ${ink}% is the dark ramp's harsh edge`);
    assert.ok(light(palette, "--surface-1") - ink > 25, `${theme.mode}: --ink would vanish`);

    const drop = palette["--drop"];
    assert.match(drop, /\/\s*0?\.\d+\s*\)/, `${theme.mode}: --drop needs an alpha, got ${drop}`);
    assert.ok(Number(/^(\d+)px/.exec(drop)?.[1]) <= 1, `${theme.mode}: --drop reads as an outline`);
    assert.ok(Number(/\/\s*(0?\.\d+)\s*\)/.exec(drop)?.[1]) <= 0.2, `${theme.mode}: --drop is heavy`);
  }
});

test("the dark ground keeps its hard edge and longer, solid throw", () => {
  const palette = buildPalette(COVER, ALBUM);
  assert.ok(Number(/^(\d+)px/.exec(palette["--drop"])?.[1]) >= 3, "dark --drop keeps its depth");
  assert.ok(light(palette, "--ink") < 10, "dark ink stays near-black");
  assert.ok(light(palette, "--ink") < light(palette, "--surface-1"));
});

test("an extreme swatch is pulled back into a usable range", () => {
  assert.ok(sat(buildPalette({ hue: 300, sat: 1 }, ALBUM), "--bg") <= 30, "clamped down");
  assert.ok(sat(buildPalette({ hue: 300, sat: 0 }, ALBUM), "--bg") > 5, "and still not grey");
});

test("surfaces carry far less hue than the accent", () => {
  const palette = buildPalette(VIVID, ALBUM);
  assert.ok(sat(palette, "--bg") < sat(palette, "--accent") / 2, "--bg is well under the accent");
  assert.ok(sat(palette, "--fg") < 12, "labels are near-neutral, not tinted");
});

test("neutral has no colour, on either ground", () => {
  for (const theme of [NEUTRAL_DARK, NEUTRAL_LIGHT]) {
    const palette = buildPalette(COVER, theme);
    for (const token of ["--bg", "--surface-1", "--fg", "--accent"]) {
      assert.ok(sat(palette, token) <= 5, `${token} at ${sat(palette, token)}% is not neutral`);
    }
  }
});

test("custom hue wraps rather than producing an invalid colour", () => {
  for (const hue of hues(buildPalette(null, { ...CUSTOM_DARK, customHue: 359 }))) {
    assert.ok(hue >= 0 && hue < 360, `hue ${hue} is out of range`);
  }
});
