import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BLACK,
  chromaOf,
  contrastRatio,
  ensureContrast,
  hexToOklch,
  hslHue,
  isHex,
  normaliseHex,
  oklchToHex,
  parseColor,
  readableOn,
  relativeLuminance,
  rotateHue,
  toHex,
  WHITE,
  type Rgb,
} from "./color.ts";

const hex = (value: string) => normaliseHex(value);

test("a colour field takes whatever a reader is likely to paste", () => {
  assert.equal(hex("#5b3fd6"), "#5b3fd6");
  assert.equal(hex("  #5B3FD6 "), "#5b3fd6");
  assert.equal(hex("5b3fd6"), "#5b3fd6");
  assert.equal(hex("#abc"), "#aabbcc");
  assert.equal(hex("#5b3fd6ff"), "#5b3fd6", "an alpha pair is read and dropped");
  assert.equal(hex("rgb(91, 63, 214)"), "#5b3fd6");
  assert.equal(hex("rgb(91 63 214)"), "#5b3fd6");
  assert.equal(hex("violet"), "#ee82ee");
  assert.equal(hex("hsl(0 100% 50%)"), "#ff0000");
  assert.equal(hex("hsl(120, 100%, 25%)"), "#008000");
});

test("anything unreadable is null, so a half-typed code never repaints the app", () => {
  for (const input of ["", "   ", "#", "#12", "#12345", "nope", "rgb(1,2)", "rgb(a,b,c)", "#gggggg"]) {
    assert.equal(hex(input), null, `${JSON.stringify(input)} should not parse`);
  }
});

test("a name that is also a property of Object is not a colour", () => {
  // The colour field's own label is "Colour, as hex, rgb() or a name", and the names live in an
  // object literal — so every key on Object.prototype answered the lookup too. "constructor"
  // came back as the Object constructor, `.slice(1)` on it threw, and because parseColor is
  // called during the field's own render, typing the word replaced the page with "This page
  // stopped working." The same throw came out of storage: a planted timbre:accents of
  // ["constructor"] goes through normaliseHex on every load of Appearance.
  for (const input of ["constructor", "__proto__", "CONSTRUCTOR", " Constructor ", "toString", "valueOf", "hasOwnProperty"]) {
    assert.equal(hex(input), null, `${JSON.stringify(input)} should not parse`);
    assert.doesNotThrow(() => contrastRatio(input, "#ffffff"));
    assert.doesNotThrow(() => hslHue(input));
    assert.doesNotThrow(() => chromaOf(input));
  }
  assert.equal(hex("violet"), "#ee82ee", "a real name still resolves");
});

test("isHex only accepts the normalised form", () => {
  assert.ok(isHex("#5b3fd6"));
  assert.ok(!isHex("#5B3FD6"));
  assert.ok(!isHex("#abc"));
  assert.ok(!isHex(null));
});

test("sRGB survives a round trip through OKLCH", () => {
  for (const colour of ["#5b3fd6", "#ffd9a8", "#1b1140", "#f3efe4", "#000000", "#ffffff", "#7f7f7f"]) {
    assert.equal(oklchToHex(hexToOklch(colour)), colour, `${colour} did not come back`);
  }
});

test("a colour outside sRGB loses chroma, not its hue", () => {
  const wanted = { l: 0.7, c: 0.37, h: 264 };
  const shown = hexToOklch(oklchToHex(wanted));
  assert.ok(shown.c < wanted.c, "chroma was pulled back into the gamut");
  assert.ok(Math.abs(shown.h - wanted.h) < 2, `hue drifted to ${shown.h}`);
});

test("black or white always reads on any sRGB colour — the guarantee everything else rests on", () => {
  let worst = 21;
  for (let r = 0; r < 256; r += 17) {
    for (let g = 0; g < 256; g += 17) {
      for (let b = 0; b < 256; b += 17) {
        const colour: Rgb = { r: r / 255, g: g / 255, b: b / 255 };
        const best = Math.max(contrastRatio(colour, WHITE), contrastRatio(colour, BLACK));
        worst = Math.min(worst, best);
        const chosen = readableOn(colour);
        assert.ok(
          contrastRatio(colour, chosen) >= 4.5,
          `${toHex(colour)} with ${chosen} is only ${contrastRatio(colour, chosen).toFixed(2)}:1`,
        );
      }
    }
  }
  assert.ok(worst >= 4.5, `the least favourable colour still managed ${worst.toFixed(2)}:1`);
});

test("readableOn picks the better of the two, not simply one of them", () => {
  assert.equal(readableOn("#ffffff"), "#000000");
  assert.equal(readableOn("#000000"), "#ffffff");
  assert.equal(readableOn("#ffd9a8"), "#000000", "a pale peach takes dark text");
  assert.equal(readableOn("#2a1a5c"), "#ffffff", "the banner's night sky takes light text");
});

test("a colour is lifted or dropped until it reads, whatever hue it started at", () => {
  for (const ground of ["#eef0f6", "#08080a"]) {
    for (const target of [4.5, 7]) {
      for (let h = 0; h < 360; h += 10) {
        for (const l of [0.2, 0.5, 0.85]) {
          const fixed = ensureContrast({ l, c: 0.2, h }, ground, target);
          const ratio = contrastRatio(oklchToHex(fixed), ground);
          assert.ok(
            ratio >= target - 0.02,
            `hue ${h} at l=${l} on ${ground} only reached ${ratio.toFixed(2)}:1 of ${target}`,
          );
          assert.ok(Math.abs(fixed.h - h) < 0.001, "the hue is never touched");
        }
      }
    }
  }
});

test("a colour that already reads is left exactly as it is", () => {
  const already = hexToOklch("#5b3fd6");
  assert.deepEqual(ensureContrast(already, "#eef0f6", 4.5), already);
});

test("rotating the hue holds lightness, so contrast survives the turn", () => {
  const start = hexToOklch("#5b3fd6");
  for (let turn = 37; turn < 360; turn += 37) {
    const moved = hexToOklch(rotateHue("#5b3fd6", turn));
    assert.ok(Math.abs(moved.l - start.l) < 0.01, `lightness moved at ${turn}°`);
    // Chroma can only *fall*, and at some hues it has to: sRGB simply holds less colour there.
    // What matters is that it is never invented, because that is what would shift contrast.
    assert.ok(moved.c <= start.c + 0.01, `chroma grew at ${turn}°`);
  }
  assert.equal(rotateHue("#5b3fd6", 360), "#5b3fd6");
  assert.equal(rotateHue("#5b3fd6", -37), rotateHue("#5b3fd6", 323));
});

test("hslHue still speaks HSL, for the code that has not moved yet", () => {
  assert.equal(hslHue("#ff0000"), 0);
  assert.equal(hslHue("#00ff00"), 120);
  assert.equal(hslHue("#0000ff"), 240);
  assert.equal(hslHue("#808080"), 0, "a grey has no hue to report");
  for (const colour of ["#5b3fd6", "#ffd9a8", "#1b1140", "#3f9d5a"]) {
    const hue = hslHue(colour);
    assert.ok(hue >= 0 && hue < 360, `${colour} reported ${hue}`);
  }
});

test("chroma tells a chosen grey from a chosen colour", () => {
  assert.ok(chromaOf("#808080") < 0.01);
  assert.ok(chromaOf("#8a8a93") < 0.025);
  assert.ok(chromaOf("#5b3fd6") > 0.15);
});

test("luminance is the CIE one, not an average of the channels", () => {
  assert.ok(relativeLuminance({ r: 0, g: 1, b: 0 }) > relativeLuminance({ r: 0, g: 0, b: 1 }) * 9);
  assert.equal(Math.round(relativeLuminance(WHITE)), 1);
  assert.equal(relativeLuminance(BLACK), 0);
});

test("parseColor clamps rather than producing an impossible colour", () => {
  assert.equal(toHex(parseColor("rgb(400, -20, 300)") ?? BLACK), "#ff00ff");
});
