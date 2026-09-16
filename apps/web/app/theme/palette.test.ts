import assert from "node:assert/strict";
import { test } from "node:test";

import { chromaOf, contrastRatio, hexToOklch, oklchHueFromHsl } from "./color.ts";
import { buildPalette, type Palette, type Swatch } from "./palette.ts";
import { CONTRAST_TARGET, PRESETS, type ThemeState } from "./custom-theme.ts";

const BASE: ThemeState = {
  mode: "custom",
  customSeed: "#5b3fd6",
  customHue: 251,
  customLight: false,
  customNeutral: false,
  contrast: "normal",
  tintSurfaces: true,
};

const ALBUM: ThemeState = { ...BASE, mode: "album" };
const PASTEL: ThemeState = { ...BASE, mode: "pastel" };
const CUSTOM_DARK: ThemeState = BASE;
const CUSTOM_LIGHT: ThemeState = { ...BASE, customLight: true };
const ALL = [ALBUM, PASTEL, CUSTOM_DARK, CUSTOM_LIGHT];

const COVER: Swatch = { hue: 190, sat: 0.55 };
const VIVID: Swatch = { hue: 300, sat: 0.7 };

/** Every seed the presets offer, plus the three ends of the range a reader can reach. */
const SEEDS = [
  ...PRESETS.map((preset) => preset.hex),
  "#ffffff",
  "#000000",
  "#2a1a5c",
];

/**
 * The tokens that carry text, and what each of them is drawn on. Eleven pairs, which is the
 * sweep 36bd71d's fix was verified with and the floor this file exists to hold.
 */
const PAIRS: [string, string][] = [
  ["--fg", "--bg"],
  ["--fg", "--surface-1"],
  ["--fg", "--surface-2"],
  ["--fg", "--surface-3"],
  ["--fg-dim", "--surface-1"],
  ["--fg-dim", "--surface-2"],
  ["--fg-dim", "--surface-3"],
  ["--fg-faint", "--surface-1"],
  ["--fg-faint", "--surface-2"],
  ["--fg-faint", "--surface-3"],
  ["--accent-fg", "--accent"],
];

const HEX = /^#[0-9a-f]{6}$/;

const lightnessOf = (palette: Palette, token: string) => hexToOklch(palette[token]).l;
const ratio = (palette: Palette, a: string, b: string) => contrastRatio(palette[a], palette[b]);

function grounds(seed: string, contrast: "normal" | "high" = "normal", tint = true) {
  const state = { ...BASE, customSeed: seed, contrast, tintSurfaces: tint };
  return [
    { name: "dark", palette: buildPalette(null, state) },
    { name: "light", palette: buildPalette(null, { ...state, customLight: true }) },
  ];
}

test("the whole ramp is sRGB, so what is measured is what is shown", () => {
  for (const theme of ALL) {
    const palette = buildPalette(COVER, theme);
    for (const token of ["--bg", "--surface-1", "--surface-3", "--fg", "--accent", "--accent-text"]) {
      assert.match(palette[token], HEX, `${theme.mode} ${token}`);
    }
    for (const token of ["--line", "--accent-wash"]) {
      assert.match(palette[token], /^rgb\(\d+ \d+ \d+ \/ [\d.]+\)$/, `${theme.mode} ${token}`);
    }
  }
});

test("a chosen colour paints as chosen, not as its hue with somebody else's lightness", () => {
  // The bug this file was rewritten for. --accent was oklch(0.74 0.174 h) on the dark ground
  // for every seed in the world, so the only thing a reader could actually change was h.
  for (const hex of ["#5b3fd6", "#8f74ff", "#ffd9a8", "#6b7280"]) {
    const seed = hexToOklch(hex);
    const accent = hexToOklch(buildPalette(null, { ...BASE, customSeed: hex })["--accent"]);
    assert.ok(
      Math.abs(accent.l - seed.l) < 0.02,
      `${hex}: lightness arrived as ${accent.l.toFixed(3)}, was chosen as ${seed.l.toFixed(3)}`,
    );
    assert.ok(
      Math.abs(accent.c - seed.c) < 0.01,
      `${hex}: chroma arrived as ${accent.c.toFixed(3)}, was chosen as ${seed.c.toFixed(3)}`,
    );
  }
});

test("violet and lilac are not the same app", () => {
  // They are one degree apart in hue and nothing else, which is why they used to paint
  // identically: a ramp that reads only the hue cannot tell them apart.
  for (const light of [false, true]) {
    const violet = buildPalette(null, { ...BASE, customSeed: "#5b3fd6", customLight: light });
    const lilac = buildPalette(null, { ...BASE, customSeed: "#8f74ff", customLight: light });
    assert.notEqual(violet["--accent"], lilac["--accent"], light ? "light" : "dark");
    assert.ok(
      Math.abs(hexToOklch(violet["--accent"]).l - hexToOklch(lilac["--accent"]).l) > 0.1,
      "and not by a rounding error",
    );
  }
});

test("a grey seed makes a grey app, and a pale one stays pale", () => {
  for (const { name, palette } of grounds("#6b7280")) {
    // Slate's own chroma is 0.023. The ramp used to hand it 0.174 — a cornflower blue — because
    // it took the hue and threw the "there is almost no colour in this" part away.
    for (const token of ["--accent", "--bg", "--surface-2", "--fg"]) {
      assert.ok(
        chromaOf(palette[token]) <= 0.025,
        `${name}: Slate left ${token} at chroma ${chromaOf(palette[token]).toFixed(3)}`,
      );
    }
  }
  // Peach is a light, quiet colour. It used to arrive as a saturated orange because the ramp
  // replaced both of those coordinates with constants.
  for (const { name, palette } of grounds("#ffd9a8")) {
    const accent = hexToOklch(palette["--accent"]);
    assert.ok(accent.l > 0.8, `${name}: peach came out at lightness ${accent.l.toFixed(3)}`);
    assert.ok(accent.c < 0.12, `${name}: peach came out at chroma ${accent.c.toFixed(3)}`);
  }
});

test("switching the tint off moves pixels for any seed that has colour in it", () => {
  for (const hex of ["#5b3fd6", "#ffd9a8", "#1f9e9a"]) {
    for (const light of [false, true]) {
      const on = buildPalette(null, { ...BASE, customSeed: hex, customLight: light });
      const off = buildPalette(null, {
        ...BASE,
        customSeed: hex,
        customLight: light,
        tintSurfaces: false,
      });
      for (const token of ["--bg", "--surface-1", "--surface-2", "--surface-3", "--fg"]) {
        assert.notEqual(on[token], off[token], `${hex} ${token}`);
        assert.ok(chromaOf(off[token]) < 0.001, `${token} should be grey with the tint off`);
      }
      // The accent is the one thing tinting does not touch: the switch says "the greys", and
      // a reader who wants a grey page with a coloured button is exactly who asks for it.
      assert.equal(on["--accent"], off["--accent"], `${hex}: the accent is not a grey`);
    }
  }
});

test("high contrast moves pixels, in the direction it says", () => {
  for (const hex of ["#5b3fd6", "#6b7280"]) {
    for (const { name, palette } of grounds(hex)) {
      const high = buildPalette(null, {
        ...BASE,
        customSeed: hex,
        customLight: name === "light",
        contrast: "high",
      });
      for (const token of ["--fg", "--fg-dim", "--fg-faint"]) {
        assert.notEqual(palette[token], high[token], `${name} ${hex} ${token}`);
        const moved = lightnessOf(high, token) - lightnessOf(palette, token);
        assert.ok(
          name === "light" ? moved < 0 : moved > 0,
          `${name} ${token} moved ${moved.toFixed(3)}, the wrong way`,
        );
      }
      for (const [fg, bg] of PAIRS) {
        assert.ok(
          ratio(high, fg, bg) >= ratio(palette, fg, bg) - 0.01,
          `${name} ${hex}: ${fg} on ${bg} got worse under high contrast`,
        );
      }
    }
  }
});

test("every text pair clears its target, for every seed, on both grounds", () => {
  // Eleven seeds, two grounds, eleven pairs. This is the measurement the muted-text fix was
  // signed off with, and letting the seed's own lightness through is only allowed while it
  // still passes.
  for (const contrast of ["normal", "high"] as const) {
    const target = CONTRAST_TARGET[contrast];
    for (const seed of SEEDS) {
      for (const tint of [true, false]) {
        for (const { name, palette } of grounds(seed, contrast, tint)) {
          for (const [fg, bg] of PAIRS) {
            const measured = ratio(palette, fg, bg);
            assert.ok(
              measured >= target,
              `${seed} ${name} ${contrast}${tint ? "" : " untinted"}: ${fg} on ${bg} is ${measured.toFixed(2)}:1, needs ${target}`,
            );
          }
          const text = contrastRatio(palette["--accent-text"], palette["--surface-1"]);
          assert.ok(
            text >= target,
            `${seed} ${name} ${contrast}: --accent-text on --surface-1 is ${text.toFixed(2)}:1`,
          );
        }
      }
    }
  }
});

test("the same holds for an album cover at any hue", () => {
  for (let hue = 0; hue < 360; hue += 11) {
    for (const theme of [ALBUM, PASTEL]) {
      const palette = buildPalette({ hue, sat: 0.7 }, theme);
      for (const [fg, bg] of PAIRS) {
        const measured = ratio(palette, fg, bg);
        assert.ok(measured >= 4.5, `${theme.mode} at ${hue}: ${fg} on ${bg} is ${measured.toFixed(2)}`);
      }
      const text = contrastRatio(palette["--accent-text"], palette["--surface-1"]);
      assert.ok(text >= 4.5, `${theme.mode} at ${hue}: --accent-text is ${text.toFixed(2)}:1`);
    }
  }
});

test("a cover's hue is converted from HSL, not reused as an OKLCH angle", () => {
  // 258 in HSL is roughly 293 in OKLCH. The sampler in app/hue.ts reads pixels in HSL, so a
  // number carried across unconverted rotates every cover toward blue.
  const converted = oklchHueFromHsl(258);
  assert.ok(converted > 270 && converted < 315, `258 should read violet, got ${converted}`);
  assert.equal(Math.round(oklchHueFromHsl(0)), 29, "red maps to the OKLCH red angle");

  const palette = buildPalette(COVER, ALBUM);
  const accent = hexToOklch(palette["--accent"]);
  assert.ok(
    Math.abs(accent.h - oklchHueFromHsl(190)) < 2,
    `a cover at HSL 190 landed on OKLCH ${accent.h.toFixed(1)}`,
  );
});

test("custom modes ignore the cover entirely", () => {
  assert.deepEqual(buildPalette({ hue: 12, sat: 0.9 }, CUSTOM_DARK), buildPalette(null, CUSTOM_DARK));
  assert.deepEqual(buildPalette(COVER, CUSTOM_LIGHT), buildPalette(null, CUSTOM_LIGHT));
});

test("dark grounds are dark and light grounds are light", () => {
  for (const theme of [ALBUM, CUSTOM_DARK]) {
    const bg = lightnessOf(buildPalette(COVER, theme), "--bg");
    assert.ok(bg > 0 && bg <= 0.3, `${theme.mode}: --bg at L ${bg}`);
  }
  for (const theme of [PASTEL, CUSTOM_LIGHT]) {
    const bg = lightnessOf(buildPalette(COVER, theme), "--bg");
    assert.ok(bg >= 0.9 && bg <= 1, `${theme.mode}: --bg at L ${bg}`);
  }
  assert.ok(lightnessOf(buildPalette(VIVID, ALBUM), "--bg") <= 0.2, "genuinely dark");
});

test("surfaces step in a consistent direction", () => {
  const dark = buildPalette(COVER, ALBUM);
  assert.ok(lightnessOf(dark, "--bg") < lightnessOf(dark, "--surface-1"));
  assert.ok(lightnessOf(dark, "--surface-1") < lightnessOf(dark, "--surface-2"));
  assert.ok(lightnessOf(dark, "--surface-2") < lightnessOf(dark, "--surface-3"));

  for (const theme of [PASTEL, CUSTOM_LIGHT]) {
    const palette = buildPalette(COVER, theme);
    assert.ok(lightnessOf(palette, "--surface-1") > lightnessOf(palette, "--surface-2"));
    assert.ok(lightnessOf(palette, "--surface-2") > lightnessOf(palette, "--surface-3"));
  }
});

test("pastel is gentler than the light ramp, in the surfaces rather than the accent", () => {
  // Pastel used to hold the accent back off full chroma as well. It no longer does: a reader
  // who picked a colour picked it on every ground, and what makes pastel soft is the page.
  const pastel = buildPalette(COVER, PASTEL);
  const solid = buildPalette(COVER, CUSTOM_LIGHT);
  assert.ok(lightnessOf(pastel, "--surface-1") > 0.999, "pastel's cards are white");
  assert.ok(lightnessOf(pastel, "--bg") < lightnessOf(pastel, "--surface-1"), "on a tinted page");
  assert.ok(lightnessOf(solid, "--bg") > lightnessOf(solid, "--surface-1"), "the other way round");
});

test("surfaces carry far less colour than the accent", () => {
  const palette = buildPalette(VIVID, ALBUM);
  assert.ok(chromaOf(palette["--bg"]) < chromaOf(palette["--accent"]) / 2);
  assert.ok(chromaOf(palette["--fg"]) < 0.03, "labels are near-neutral, not tinted");
});

test("--ink is a drawn edge and --line is a quiet divider, and they are not the same", () => {
  for (const theme of ALL) {
    const palette = buildPalette(COVER, theme);
    assert.notEqual(palette["--ink"], palette["--line"], theme.mode);
    const alpha = (value: string) => Number(/\/ ([\d.]+)\)/.exec(value)?.[1] ?? 1);
    assert.ok(
      alpha(palette["--ink"]) > alpha(palette["--line"]),
      `${theme.mode}: --ink is no more visible than --line`,
    );
    assert.ok(alpha(palette["--ink"]) >= 0.2, `${theme.mode}: --ink will not read as an edge`);
  }
});

test("shadows are ambient, not hard offsets", () => {
  for (const theme of ALL) {
    const palette = buildPalette(COVER, theme);
    for (const token of ["--drop", "--drop-sm", "--drop-lg"]) {
      const lengths = /^(-?[\d.]+(?:px)?)\s+(-?[\d.]+px)\s+(-?[\d.]+px)/.exec(palette[token]);
      assert.ok(lengths, `${theme.mode} ${token}: expected three lengths, got ${palette[token]}`);
      assert.equal(Number(lengths[1].replace("px", "")), 0, `${token} should not offset sideways`);
      assert.ok(Number(lengths[3].replace("px", "")) > 0, `${token}: blur 0 is the sticker shadow`);
    }
    const blur = (token: string) => Number(/\s(-?[\d.]+)px\s+rgb/.exec(palette[token])?.[1]);
    assert.ok(blur("--drop-lg") > blur("--drop-sm"), `${theme.mode}: -lg should throw further`);
  }
});

test("a near-black seed on the dark ground still produces a button you can see", () => {
  const palette = buildPalette(null, { ...BASE, customSeed: "#0d0718" });
  assert.ok(
    contrastRatio(palette["--accent"], palette["--bg"]) >= 1.5,
    `the accent sank into the page at ${contrastRatio(palette["--accent"], palette["--bg"]).toFixed(2)}:1`,
  );
});
