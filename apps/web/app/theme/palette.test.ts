import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildPalette,
  hslHueToOklch,
  oklchToRgb,
  readableOn,
  type Palette,
  type Swatch,
} from "./palette.ts";
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

// The ramp is OKLCH now: `oklch(L C H)` or `oklch(L C H / a)`. L is 0–1 perceptual
// lightness, C is an absolute chroma distance (0 grey, ~0.37 the sRGB edge), H is
// degrees on the OKLCH wheel — NOT the HSL wheel the swatch arrives on, which is
// why the hue assertions below convert before comparing.
const OKLCH = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)/;

function parts(palette: Palette, token: string) {
  const match = OKLCH.exec(palette[token]);
  assert.ok(match, `${token} should be an oklch() colour, got ${palette[token]}`);
  return {
    L: Number(match[1]),
    C: Number(match[2]),
    H: Number(match[3]),
    alpha: match[4] === undefined ? 1 : Number(match[4]),
  };
}

const light = (palette: Palette, token: string) => parts(palette, token).L;
const chroma = (palette: Palette, token: string) => parts(palette, token).C;
const gap = (palette: Palette, a: string, b: string) => Math.abs(light(palette, a) - light(palette, b));

function hues(palette: Palette): number[] {
  return Object.values(palette).flatMap((value) => {
    const all = [...value.matchAll(new RegExp(OKLCH, "g"))];
    return all.map((m) => Number(m[3]));
  });
}

/** WCAG contrast between a token and a plain hex, both resolved to sRGB. */
function ratioAgainstHex(palette: Palette, token: string, hex: string): number {
  const { L, C, H } = parts(palette, token);
  const rgb = oklchToRgb(L, C, H);
  const hexRgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const lum = (c: [number, number, number]) => {
    const [r, g, b] = c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = lum(rgb);
  const b = lum(hexRgb);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test("album takes its hue from the cover", () => {
  const expected = Number(hslHueToOklch(190).toFixed(1));
  const coloured = hues(buildPalette(COVER, ALBUM)).filter((hue) => hue !== 0);
  assert.deepEqual(new Set(coloured), new Set([expected]), "the whole ramp is one hue");
});

test("the hue is converted from HSL, not reused as an OKLCH angle", () => {
  // Violet is 258 in HSL and roughly 293 on the OKLCH wheel. Reusing the number
  // unconverted would rotate every theme toward blue, silently.
  const converted = hslHueToOklch(258);
  assert.ok(Math.abs(converted - 258) > 20, `258 should move, landed at ${converted}`);
  assert.ok(converted > 270 && converted < 315, `258 should read violet, got ${converted}`);
  assert.equal(Math.round(hslHueToOklch(0)), 29, "red maps to the OKLCH red angle");
});

test("custom and neutral ignore the cover entirely", () => {
  for (const theme of [CUSTOM_DARK, NEUTRAL_DARK]) {
    assert.deepEqual(buildPalette({ hue: 12, sat: 0.9 }, theme), buildPalette(null, theme));
    assert.deepEqual(buildPalette(COVER, theme), buildPalette(null, theme));
  }
  const chosen = Number(hslHueToOklch(12).toFixed(1));
  const cover = Number(hslHueToOklch(190).toFixed(1));
  assert.ok(hues(buildPalette(COVER, CUSTOM_DARK)).includes(chosen), "custom uses the chosen hue");
  assert.ok(!hues(buildPalette(COVER, CUSTOM_DARK)).includes(cover));
});

test("a missing swatch still yields a usable palette", () => {
  for (const theme of [ALBUM, PASTEL]) {
    const palette = buildPalette(null, theme);
    assert.ok(Object.keys(palette).length > 10, `${theme.mode} produced a full palette`);
    assert.ok(light(palette, "--fg") >= 0 && light(palette, "--fg") <= 1);
  }
});

test("dark grounds are dark and light grounds are light", () => {
  const cases: [ThemeState, number, number][] = [
    [ALBUM, 0, 0.3],
    [CUSTOM_DARK, 0, 0.3],
    [NEUTRAL_DARK, 0, 0.3],
    [PASTEL, 0.9, 1],
    [CUSTOM_LIGHT, 0.9, 1],
    [NEUTRAL_LIGHT, 0.9, 1],
  ];
  for (const [theme, low, high] of cases) {
    const bg = light(buildPalette(COVER, theme), "--bg");
    assert.ok(bg > low && bg <= high, `${theme.mode}: --bg at L ${bg} is outside ${low}–${high}`);
  }
  assert.ok(light(buildPalette(VIVID, ALBUM), "--bg") <= 0.2, "the album ground is genuinely dark");
});

test("every ramp's body text clears AA against the surface it sits on", () => {
  // The old version of this test compared HSL lightness numbers, which is not
  // contrast — two colours 40 points apart in HSL L can still fail AA. This
  // measures the actual WCAG ratio.
  for (const theme of ALL) {
    const palette = buildPalette(COVER, theme);
    const surface = parts(palette, "--surface-1");
    const surfaceHex = oklchToRgb(surface.L, surface.C, surface.H);
    const asHex =
      "#" +
      surfaceHex.map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("");
    const fg = ratioAgainstHex(palette, "--fg", asHex);
    assert.ok(fg >= 4.5, `${theme.mode}: --fg on --surface-1 is ${fg.toFixed(2)}:1, needs 4.5`);
  }
});

test("muted text clears AA on the busiest surface it is used on", () => {
  // --fg-faint is the caption/eyebrow/track-count colour and it is used at
  // 10-12px, so it is never exempt as large text. It was failing AA in all
  // three static themes when this was measured (2.62-3.24 against --surface-3);
  // the generated ramp has to hold the line the static tokens now hold.
  for (const theme of ALL) {
    const palette = buildPalette(COVER, theme);
    for (const surface of ["--surface-1", "--surface-2", "--surface-3"]) {
      const s = parts(palette, surface);
      const hex =
        "#" +
        oklchToRgb(s.L, s.C, s.H)
          .map((c) => Math.round(c * 255).toString(16).padStart(2, "0"))
          .join("");
      const ratio = ratioAgainstHex(palette, "--fg-faint", hex);
      assert.ok(
        ratio >= 4.5,
        `${theme.mode}: --fg-faint on ${surface} is ${ratio.toFixed(2)}:1, needs 4.5`,
      );
    }
  }
});

test("accent text is derived from the accent, so it can never fail AA", () => {
  // This is the regression that mattered: --accent-fg used to be authored on its
  // own ramp, independent of --accent, so an artwork-driven accent could drift
  // until the label on a button became unreadable. Sweep every hue.
  for (let hue = 0; hue < 360; hue += 7) {
    for (const theme of ALL) {
      const palette = buildPalette({ hue, sat: 0.7 }, { ...theme, customHue: hue });
      const accent = parts(palette, "--accent");
      const ratio = ratioAgainstHex(palette, "--accent", palette["--accent-fg"]);
      assert.ok(
        ratio >= 4.5,
        `${theme.mode} at hue ${hue}: accent-fg on accent is ${ratio.toFixed(2)}:1 (accent L ${accent.L})`,
      );
    }
  }
});

test("readableOn always finds a foreground clearing AA, for any colour", () => {
  // The proof this relies on: the white-contrast and black-contrast curves cross
  // at luminance 0.1791, where both are 4.54 — so the better of the two is never
  // below 4.5. Sample the cube rather than trusting the algebra.
  for (let r = 0; r <= 1.0001; r += 0.25) {
    for (let g = 0; g <= 1.0001; g += 0.25) {
      for (let b = 0; b <= 1.0001; b += 0.25) {
        const { ratio } = readableOn([r, g, b]);
        assert.ok(ratio >= 4.5, `rgb(${r},${g},${b}) only reached ${ratio.toFixed(2)}:1`);
      }
    }
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
  const pastel = chroma(buildPalette(COVER, PASTEL), "--accent");
  const album = chroma(buildPalette(COVER, ALBUM), "--accent");
  assert.ok(pastel < album, `pastel accent chroma ${pastel} should be under ${album}`);
});

test("--ink is a drawn edge and --line is a quiet divider, and they are not the same", () => {
  // They used to be identical, from a pass that was chasing a hairline-only look. That silently
  // cancelled the 2px ink edge globals.css had gone back to, because this file writes inline and
  // inline wins — the app drew hairlines everywhere while the stylesheet asked for an outline.
  for (const theme of ALL) {
    const palette = buildPalette(COVER, theme);
    assert.notEqual(
      palette["--ink"],
      palette["--line"],
      `${theme.mode}: an edge and a divider are different jobs`,
    );

    const ink = parts(palette, "--ink");
    const line = parts(palette, "--line");
    assert.ok(
      ink.alpha > line.alpha,
      `${theme.mode}: --ink at ${ink.alpha} is no more visible than --line at ${line.alpha}`,
    );
    assert.ok(ink.alpha >= 0.2, `${theme.mode}: --ink at ${ink.alpha} will not read as an edge`);
  }
});

test("shadows are ambient, not hard offsets", () => {
  for (const theme of ALL) {
    const palette = buildPalette(COVER, theme);
    for (const token of ["--drop", "--drop-sm", "--drop-lg"]) {
      const value = palette[token];
      const lengths = /^(-?[\d.]+(?:px)?)\s+(-?[\d.]+px)\s+(-?[\d.]+px)/.exec(value);
      assert.ok(lengths, `${theme.mode} ${token}: expected three lengths, got ${value}`);
      assert.equal(
        Number(lengths[1].replace("px", "")),
        0,
        `${theme.mode} ${token}: should not offset sideways`,
      );
      assert.ok(
        Number(lengths[3].replace("px", "")) > 0,
        `${theme.mode} ${token}: blur is 0, that is the sticker shadow`,
      );
    }
    const blur = (token: string) => Number(/\s(-?[\d.]+)px\s+oklch/.exec(palette[token])?.[1]);
    assert.ok(blur("--drop-lg") > blur("--drop-sm"), `${theme.mode}: -lg should throw further`);
  }
});

test("an extreme swatch is pulled back into a usable range", () => {
  assert.ok(chroma(buildPalette({ hue: 300, sat: 1 }, ALBUM), "--bg") <= 0.03, "clamped down");
  assert.ok(chroma(buildPalette({ hue: 300, sat: 0 }, ALBUM), "--bg") > 0.005, "and still not grey");
});

test("surfaces carry far less hue than the accent", () => {
  const palette = buildPalette(VIVID, ALBUM);
  assert.ok(
    chroma(palette, "--bg") < chroma(palette, "--accent") / 2,
    "--bg is well under the accent",
  );
  assert.ok(chroma(palette, "--fg") < 0.03, "labels are near-neutral, not tinted");
});

test("neutral has no colour, on either ground", () => {
  for (const theme of [NEUTRAL_DARK, NEUTRAL_LIGHT]) {
    const palette = buildPalette(COVER, theme);
    for (const token of ["--bg", "--surface-1", "--fg", "--accent"]) {
      const c = chroma(palette, token);
      assert.ok(c <= 0.02, `${token} at chroma ${c} is not neutral`);
    }
  }
});

test("custom hue wraps rather than producing an invalid colour", () => {
  for (const hue of hues(buildPalette(null, { ...CUSTOM_DARK, customHue: 359 }))) {
    assert.ok(hue >= 0 && hue < 360, `hue ${hue} is out of range`);
  }
});
