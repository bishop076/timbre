import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanFamily, FALLBACK, FONT_IDS, FONTS, fontStack, isFontId } from "./fonts.ts";

const GENERIC = ["sans-serif", "serif", "monospace", "system-ui", "cursive"];

test("every built-in stack ends somewhere the device certainly has", () => {
  for (const font of FONTS) {
    if (font.stack === null) continue;
    const last = font.stack.split(",").at(-1)?.trim() ?? "";
    assert.ok(
      GENERIC.includes(last),
      `${font.id} ends in "${last}", which this device may simply not have`,
    );
  }
});

test("a named face is never the only thing in a stack", () => {
  for (const font of FONTS) {
    if (font.stack === null) continue;
    assert.ok(font.stack.split(",").length >= 2, `${font.id} has nothing to fall back to`);
  }
});

test("the app's own face is left alone rather than named", () => {
  // Returning null means --font-ui is removed, and globals.css keeps whatever it set. Naming
  // Geist here would mean persisting `var(--font-geist-sans)`, which the pre-paint script in
  // layout.tsx refuses to write — var() is on its list of things a stored value may not contain.
  assert.equal(fontStack("default"), null);
  assert.ok(!FONTS.some((font) => font.stack?.includes("var(")));
});

test("an uploaded font is quoted, and still has the fallback after it", () => {
  assert.equal(fontStack("custom", "My Font"), `"My Font", ${FALLBACK}`);
  assert.equal(fontStack("custom", ""), null, "no family means no override at all");
  assert.equal(fontStack("custom", "   "), null);
});

test("a family name cannot carry CSS out of the field it was typed into", () => {
  assert.equal(cleanFamily('Evil"; } body { display: none } @font-face { a: "'), "Evil  body  display none  font-face  a");
  assert.equal(cleanFamily("url(https://example.com/x)"), "urlhttpsexample.comx".replace(/[^\w \-]/g, ""));
  assert.ok(!cleanFamily('a"b;c{d}e').includes('"'));
  assert.ok(!cleanFamily('a"b;c{d}e').includes(";"));
  assert.ok(!cleanFamily('a"b;c{d}e').includes("{"));
  assert.equal(cleanFamily("x".repeat(200)).length, 48, "and it cannot be unbounded either");
  assert.match(fontStack("custom", 'Evil"; }') ?? "", /^"[\w \-]+", /);
});

test("the ids are what gets stored, and only these", () => {
  assert.deepEqual(FONT_IDS, [
    "default",
    "system",
    "serif",
    "rounded",
    "mono",
    "legible",
    "dyslexic",
    "custom",
  ]);
  for (const id of FONT_IDS) assert.ok(isFontId(id));
  for (const other of ["", "geist", "Default", null, 7, {}]) assert.ok(!isFontId(other));
});

test("there is a choice for someone who finds the default hard to read", () => {
  const ids = FONTS.map((font) => font.id);
  assert.ok(ids.includes("legible"));
  assert.ok(ids.includes("dyslexic"));
  assert.match(fontStack("dyslexic") ?? "", /OpenDyslexic/);
  assert.match(fontStack("legible") ?? "", /Atkinson Hyperlegible/);
});
