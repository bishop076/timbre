import assert from "node:assert/strict";
import { test } from "node:test";

import { chromaOf, contrastRatio, hexToOklch, hslHue } from "./color.ts";
import {
  accentFor,
  accentForeground,
  artworkSeed,
  BANNER,
  SKIN,
  clampBlur,
  clampDim,
  clampScale,
  CONTRAST_TARGET,
  CYCLE_STEP_MS,
  DEFAULT_ACCENT,
  DEFAULT_BACKGROUND,
  DEFAULT_THEME,
  GROUND,
  isNeutralSeed,
  legacyMirror,
  MAX_DIM,
  MIN_DIM,
  mix,
  msToNextStep,
  parseTheme,
  PRESETS,
  resolveGround,
  scrimIsReadable,
  seedAt,
  themeVars,
  withMirror,
  type Theme,
} from "./custom-theme.ts";

const theme = (patch: Partial<Theme> = {}): Theme => withMirror({ ...DEFAULT_THEME, ...patch });

test("nobody choosing anything means the banner violet, on dark, and the app keeps its own colour", () => {
  assert.equal(DEFAULT_ACCENT, "#5b3fd6");
  assert.equal(DEFAULT_ACCENT, SKIN.accent);
  assert.equal(DEFAULT_ACCENT, BANNER.violet, "the app wears the mark's colour");
  assert.equal(DEFAULT_THEME.accent, "#5b3fd6");
  assert.equal(DEFAULT_THEME.ground, "dark");
  assert.equal(
    DEFAULT_THEME.accentSource,
    "fixed",
    "the brand colour shows until someone opts into artwork tinting",
  );
  assert.equal(DEFAULT_THEME.contrast, "normal");
  assert.equal(DEFAULT_THEME.textScale, 1);
  assert.equal(parseTheme(null).accent, "#5b3fd6");
  assert.equal(parseTheme(undefined).accent, "#5b3fd6");
  assert.equal(parseTheme("nonsense").accent, "#5b3fd6");
  assert.equal(parseTheme(42).ground, "dark");
});

test("the app and the mark are the same colour, and pink is still one tap away", () => {
  // This went pink for an afternoon, read off reference screenshots that were about the look
  // rather than the hue. The colour had already been specified: the banner's violet.
  assert.equal(SKIN.accent, BANNER.violet);
  assert.ok(
    PRESETS.some((preset) => preset.hex === "#ff6fa8"),
    "blush is offered, it is simply not the default",
  );
});

test("the presets are a shortcut, not a catalogue", () => {
  assert.ok(PRESETS.length >= 6 && PRESETS.length <= 8, `${PRESETS.length} is not a short row`);
  assert.equal(PRESETS[0].hex, DEFAULT_ACCENT, "the app's own colour comes first");

  assert.equal(new Set(PRESETS.map((preset) => preset.hex)).size, PRESETS.length, "no repeats");
  assert.equal(new Set(PRESETS.map((preset) => preset.name)).size, PRESETS.length);
  for (const preset of PRESETS) {
    assert.match(preset.hex, /^#[0-9a-f]{6}$/, `${preset.name} is not a plain hex`);
  }

  // The banner is where the palette comes from, so it is where the shortcuts start.
  for (const hex of [BANNER.violet, BANNER.lilac, BANNER.sun]) {
    assert.ok(
      PRESETS.some((preset) => preset.hex === hex),
      `${hex} is a banner colour and should be offered`,
    );
  }

  // Far enough apart to be a choice. Two swatches a reader cannot tell apart are one swatch and
  // a wasted tap. The one close pair is violet and lilac, which is a tone and its tint off the
  // same banner and reads as two things; greys are exempt, having no hue to be distant in.
  const colourful = PRESETS.filter((preset) => !isNeutralSeed(preset.hex)).map((preset) => ({
    ...preset,
    ...hexToOklch(preset.hex),
  }));
  for (let i = 0; i < colourful.length; i++) {
    for (let j = i + 1; j < colourful.length; j++) {
      const first = colourful[i];
      const second = colourful[j];
      const apart = Math.abs((((first.h - second.h + 540) % 360) + 360) % 360 - 180);
      assert.ok(
        apart >= 18 || Math.abs(first.l - second.l) >= 0.15,
        `${first.name} and ${second.name} are the same colour twice`,
      );
    }
  }
});

test("the seed already clears both grounds, so it is used as chosen", () => {
  // The banner violet carries white at 6.72:1 on the light page and clears the dark ground too,
  // which the pink this briefly was did not — that needed walking down to #c33675 before it
  // could hold a word. A seed that already passes should come through untouched.
  const light = accentFor(DEFAULT_ACCENT, "light", "normal");
  assert.ok(
    contrastRatio(light, GROUND.light) >= 4.5,
    `${light} on ${GROUND.light} is ${contrastRatio(light, GROUND.light).toFixed(2)}`,
  );
  assert.ok(Math.abs(hslHue(light) - hslHue(DEFAULT_ACCENT)) <= 8, "the hue is held");

  // The dark ground needs no such rescue: the seed already clears it.
  const dark = accentFor(DEFAULT_ACCENT, "dark", "normal");
  assert.ok(contrastRatio(dark, GROUND.dark) >= 4.5);
  assert.ok(Math.abs(hslHue(dark) - hslHue(DEFAULT_ACCENT)) <= 8);
});

test("every offered colour, on every ground, at every contrast, is readable", () => {
  for (const preset of PRESETS) {
    for (const ground of ["light", "dark"] as const) {
      for (const contrast of ["normal", "high"] as const) {
        const accent = accentFor(preset.hex, ground, contrast);
        const ratio = contrastRatio(accent, GROUND[ground]);
        assert.ok(
          ratio >= CONTRAST_TARGET[contrast] - 0.02,
          `${preset.name} on ${ground} at ${contrast}: ${ratio.toFixed(2)}:1`,
        );
        assert.ok(
          contrastRatio(accent, accentForeground(accent)) >= 4.5,
          `${preset.name}: the text on the accent is not readable`,
        );
      }
    }
  }
});

test("a colour chosen at random is held to the same bar", () => {
  for (let h = 0; h < 360; h += 7) {
    for (const ground of ["light", "dark"] as const) {
      const seed = artworkSeed({ h: h / 360, s: 0.9 }, ground);
      const accent = accentFor(seed, ground, "high");
      assert.ok(
        contrastRatio(accent, GROUND[ground]) >= 7 - 0.02,
        `hue ${h} on ${ground} fell short`,
      );
    }
  }
});

test("the foreground on the accent is derived, never authored", () => {
  for (const seed of ["#ffffff", "#000000", "#ffd9a8", "#1b1140", "#3f9d5a", "#e2476d"]) {
    const accent = accentFor(seed, "dark", "normal");
    const foreground = accentForeground(accent);
    assert.ok(["#ffffff", "#000000"].includes(foreground));
    assert.ok(contrastRatio(accent, foreground) >= 4.5, `${seed} produced unreadable accent text`);
  }
});

test("a saved template keeps its ground, and is reset onto the app's own colour", () => {
  // Two things are happening here and they are deliberately different.
  //
  // Ground, scale, background and font are choices about something the redesign did not
  // redefine, so a stored template keeps them: "album" was always a dark theme and stays one.
  //
  // The accent and where it comes from ARE what the redesign redefined. A version-1 store was
  // written when the app was violet and drove its colour from the artwork, so leaving those
  // alone would mean the new default never reached anybody who had opened the app even once —
  // which is exactly what happened, and looked like the default simply not working.
  const album = parseTheme({ mode: "album", customHue: 258, customLight: false, customNeutral: false });
  assert.equal(album.ground, "dark", "the ground a template implied is kept");
  assert.equal(album.accentSource, "fixed", "but it wears the app's colour until asked otherwise");
  assert.equal(album.accent, DEFAULT_ACCENT);

  const pastel = parseTheme({ mode: "pastel", customHue: 258, customLight: false, customNeutral: false });
  assert.equal(pastel.ground, "light");
  assert.equal(pastel.accentSource, "fixed");

  const custom = parseTheme({ mode: "custom", customHue: 120, customLight: true, customNeutral: false });
  assert.equal(custom.ground, "light");
  assert.equal(custom.accentSource, "fixed");
  assert.equal(custom.mode, "custom");
});

test("a store already on this version is left exactly as the reader left it", () => {
  // The migration must be a one-off, not a rule. Once v is current, a chosen colour and a
  // chosen source survive every read — otherwise nobody could ever pick anything again.
  // DEFAULT_THEME.v rather than a literal: this test is about "current version is not migrated",
  // and writing the number here means it silently starts testing the migration path instead the
  // next time the version moves — which is exactly what happened on the first bump.
  const chosen = parseTheme({
    v: DEFAULT_THEME.v,
    ground: "light",
    accentSource: "artwork",
    accent: "#2f6fe0",
    contrast: "high",
    textScale: 1.25,
  });
  assert.equal(chosen.accentSource, "artwork");
  assert.equal(chosen.accent, "#2f6fe0");
  assert.equal(chosen.ground, "light");
  assert.equal(chosen.contrast, "high");
  assert.equal(chosen.textScale, 1.25);
  assert.equal(parseTheme(chosen).accent, "#2f6fe0", "and a round trip does not migrate it again");

  const neutral = parseTheme({ mode: "custom", customHue: 200, customLight: false, customNeutral: true });
  assert.ok(isNeutralSeed(neutral.accent), "a neutral theme stays grey");
  assert.equal(neutral.tintSurfaces, false);
  assert.equal(neutral.customNeutral, true);
});

test("storage is not trusted: everything out of range is pulled back", () => {
  const junk = parseTheme({
    ground: "sideways",
    accentSource: "vibes",
    accent: "drop database",
    contrast: 7,
    tintSurfaces: "yes",
    textScale: 900,
    background: { fit: "url(evil)", dim: -5, blur: 9000 },
    font: { id: "../../etc/passwd", family: 'Evil"; } body { display: none } @font-face { a: "' },
  });

  assert.equal(junk.ground, "dark");
  // The default, not a hardcoded copy of it — this test is about junk falling back, not about
  // which source is currently default.
  assert.equal(junk.accentSource, DEFAULT_THEME.accentSource);
  assert.equal(junk.accent, DEFAULT_ACCENT);
  assert.equal(junk.contrast, "normal");
  assert.equal(junk.tintSurfaces, true);
  assert.equal(junk.textScale, 1.5);
  assert.equal(junk.background.fit, "cover");
  assert.equal(junk.background.dim, MIN_DIM);
  assert.equal(junk.background.blur, 40);
  assert.equal(junk.font.id, "default");
  assert.equal(junk.font.family, "");
});

test("a stored theme survives a round trip through JSON unchanged", () => {
  const saved = theme({ accent: "#3f9d5a", ground: "light", accentSource: "cycle", contrast: "high" });
  const back = parseTheme(JSON.parse(JSON.stringify(saved)));
  for (const key of ["accent", "ground", "accentSource", "contrast", "tintSurfaces"] as const) {
    assert.deepEqual(back[key], saved[key], `${key} did not survive`);
  }
});

test("the legacy mirror says the same thing the new fields do", () => {
  assert.equal(legacyMirror(theme({ accentSource: "artwork" }), "#5b3fd6", false).mode, "album");
  assert.equal(legacyMirror(theme({ accentSource: "artwork" }), "#5b3fd6", true).mode, "pastel");
  assert.equal(legacyMirror(theme({ accentSource: "fixed" }), "#5b3fd6", false).mode, "custom");
  assert.equal(legacyMirror(theme({ accentSource: "cycle" }), "#5b3fd6", false).mode, "custom");

  const light = withMirror(theme({ ground: "light" }));
  assert.equal(light.customLight, true);
  assert.equal(light.customHue, hslHue(light.accent));

  const grey = withMirror(theme({ accent: "#8a8a93", tintSurfaces: false, accentSource: "fixed" }));
  assert.equal(grey.customNeutral, true, "a grey seed with no tint is what neutral meant");
  const tinted = withMirror(theme({ accent: "#8a8a93", tintSurfaces: true, accentSource: "fixed" }));
  assert.equal(tinted.customNeutral, false);
});

test("a ground of system follows the device, and the fixed ones ignore it", () => {
  assert.equal(resolveGround(theme({ ground: "system" }), true), "dark");
  assert.equal(resolveGround(theme({ ground: "system" }), false), "light");
  assert.equal(resolveGround(theme({ ground: "dark" }), false), "dark");
  assert.equal(resolveGround(theme({ ground: "light" }), true), "light");
});

test("a fixed colour never moves, and a cover's colour is taken when there is one", () => {
  const fixed = theme({ accentSource: "fixed", accent: "#3f9d5a" });
  assert.equal(seedAt(fixed, 0), "#3f9d5a");
  assert.equal(seedAt(fixed, 1e12), "#3f9d5a");
  assert.equal(seedAt(fixed, 0, "#ff0000"), "#3f9d5a", "a cover cannot override a fixed colour");

  const cover = theme({ accentSource: "artwork" });
  assert.equal(seedAt(cover, 0, "#ff0000"), "#ff0000");
  assert.equal(seedAt(cover, 0, null), DEFAULT_ACCENT, "with no cover, the chosen colour stands in");
});

test("the cycle is a function of the clock, so every tab agrees without saying a word", () => {
  const cycling = theme({ accentSource: "cycle", accent: DEFAULT_ACCENT });
  const at = (ms: number) => seedAt(cycling, ms);

  assert.equal(at(1_000), at(1_500), "inside one step the colour is held");
  assert.equal(at(1_000), at(CYCLE_STEP_MS - 1));
  assert.notEqual(at(1_000), at(CYCLE_STEP_MS + 1), "and it moves at the boundary");

  const seen = new Set<string>();
  for (let step = 0; step < 24; step++) seen.add(at(step * CYCLE_STEP_MS + 1));
  assert.ok(seen.size >= 20, `the walk repeats too early: ${seen.size} colours in 24 steps`);

  // Chroma is held by the rotation and then trimmed by sRGB, which holds far less colour at
  // some hues than at violet. Trimmed is fine; grey would not be.
  for (const step of [0, 3, 17, 4_000_000]) {
    const seed = at(step * CYCLE_STEP_MS + 1);
    assert.match(seed, /^#[0-9a-f]{6}$/);
    assert.ok(chromaOf(seed) > 0.04, `step ${step} drifted to grey`);
  }
});

test("the cycle timer sleeps to the next boundary and no longer", () => {
  assert.equal(msToNextStep(0), CYCLE_STEP_MS);
  assert.equal(msToNextStep(CYCLE_STEP_MS - 1), 1);
  for (const now of [1, 999, 45_001, Date.now()]) {
    const wait = msToNextStep(now);
    assert.ok(wait > 0 && wait <= CYCLE_STEP_MS, `${now} asked for ${wait}ms`);
  }
});

test("a cover's colour arrives as a usable seed, however grey or garish the cover", () => {
  for (const s of [0, 0.3, 1]) {
    for (const ground of ["light", "dark"] as const) {
      const seed = artworkSeed({ h: 0.6, s }, ground);
      assert.match(seed, /^#[0-9a-f]{6}$/);
      assert.ok(contrastRatio(accentFor(seed, ground, "normal"), GROUND[ground]) >= 4.4);
    }
  }
});

test("the dimming under a background picture has a floor the reader cannot remove", () => {
  assert.equal(clampDim(0), MIN_DIM);
  assert.equal(clampDim(-1), MIN_DIM);
  assert.equal(clampDim(1), MAX_DIM);
  assert.equal(clampDim(0.5), 0.5);
  assert.equal(clampBlur(-3), 0);
  assert.equal(clampBlur(1000), 40);
  assert.equal(clampScale(0.1), 0.85);
  assert.equal(clampScale(4), 1.5);
  assert.equal(clampScale(1.234), 1.23);
});

test("the dimming a picture arrives with already passes the check the picker shows", () => {
  // The default cannot be a value that trips the app's own warning the moment a picture is
  // chosen, and 0.55 did exactly that on the dark ground.
  assert.ok(scrimIsReadable(DEFAULT_BACKGROUND.dim, false, "#f2f2f5"), "dark ground");
  assert.ok(scrimIsReadable(DEFAULT_BACKGROUND.dim, true, "#101014"), "light ground");
  assert.equal(DEFAULT_BACKGROUND.fit, "cover");
});

test("a fully dimmed picture keeps body text readable on either ground", () => {
  assert.ok(scrimIsReadable(MAX_DIM, false, "#f4f4f7"), "dark ground, white text");
  assert.ok(scrimIsReadable(MAX_DIM, true, "#232733"), "light ground, dark text");
  assert.ok(!scrimIsReadable(MIN_DIM, false, "#f4f4f7"), "and the floor alone is not a promise");
});

test("mixing is what compositing a scrim actually does", () => {
  assert.equal(mix("#000000", "#ffffff", 0), "#000000");
  assert.equal(mix("#000000", "#ffffff", 1), "#ffffff");
  assert.equal(mix("#000000", "#ffffff", 0.5), "#808080");
});

test("the variables this layer paints are only its own", () => {
  const vars = themeVars(theme({ accent: "#3f9d5a" }), "#3f9d5a", false);
  assert.deepEqual(Object.keys(vars).sort(), ["--accent-seed", "--accent-seed-fg", "--ui-scale"]);
  assert.match(vars["--accent-seed"], /^#[0-9a-f]{6}$/);
  assert.ok(contrastRatio(vars["--accent-seed"], vars["--accent-seed-fg"]) >= 4.5);
  assert.ok(
    !Object.keys(vars).some((name) => ["--bg", "--fg", "--accent", "--accent-fg"].includes(name)),
    "the ramp's own tokens have one writer, and it is not this",
  );
});
