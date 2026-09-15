import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ACCENT_HISTORY_LIMIT,
  ACCENT_HISTORY_KEY,
  getAccentHistory,
  parseAccentHistory,
  rememberAccent,
} from "./accent-history.ts";
import { PRESETS } from "./custom-theme.ts";

test("three, and the key is this app's", () => {
  assert.equal(ACCENT_HISTORY_LIMIT, 3);
  assert.equal(ACCENT_HISTORY_KEY, "timbre:accents");
});

test("nothing readable in storage means no history at all", () => {
  for (const stored of [null, undefined, 0, "#5b3fd6", {}, { 0: "#5b3fd6" }, []]) {
    assert.deepEqual(parseAccentHistory(stored), []);
  }
  assert.deepEqual(parseAccentHistory([1, true, null, {}, "not a colour"]), []);
});

test("the cap is enforced on the way out, not only on the way in", () => {
  // The bug this exists to prevent, four times over in this codebase: slice on write, take back
  // whatever is found on read. A second tab, an older build or a hand-edited key is enough.
  const stored = ["#111111", "#222222", "#333333", "#444444", "#555555"];
  assert.deepEqual(parseAccentHistory(stored), ["#111111", "#222222", "#333333"]);
});

test("only #rrggbb survives the read, whatever form it was written in", () => {
  assert.deepEqual(parseAccentHistory(["#ABC", "rgb(91 63 214)", "teal"]), [
    "#aabbcc",
    "#5b3fd6",
    "#008080",
  ]);
});

test("a bad entry costs one swatch, not the two behind it", () => {
  // Truncating at the first unreadable value would throw away colours that are perfectly fine.
  assert.deepEqual(parseAccentHistory([{}, "#111111", 7, "#222222", "#333333", "#444444"]), [
    "#111111",
    "#222222",
    "#333333",
  ]);
});

test("a repeat in storage does not spend two of the three slots", () => {
  assert.deepEqual(parseAccentHistory(["#111111", "#111111", "#222222"]), ["#111111", "#222222"]);
});

test("what the reader picks is kept newest-first, three deep, without repeats", () => {
  assert.deepEqual(getAccentHistory(), [], "nothing picked yet");

  rememberAccent("#111111");
  rememberAccent("#222222");
  assert.deepEqual(getAccentHistory(), ["#222222", "#111111"], "newest first");

  // Anything unreadable is not a choice, and neither is picking the colour already at the front.
  rememberAccent("nonsense");
  rememberAccent("");
  rememberAccent("#222222");
  assert.deepEqual(getAccentHistory(), ["#222222", "#111111"]);

  // Whatever form it arrives in, it is stored as #rrggbb — the picker's own gate.
  rememberAccent("rgb(51 51 51)");
  assert.deepEqual(getAccentHistory(), ["#333333", "#222222", "#111111"]);

  // Full: the oldest falls off the end rather than the list growing.
  rememberAccent("#444444");
  assert.deepEqual(getAccentHistory(), ["#444444", "#333333", "#222222"]);
  assert.equal(getAccentHistory().length, ACCENT_HISTORY_LIMIT);

  // Coming back to one already held moves it to the front instead of duplicating it.
  rememberAccent("#222222");
  assert.deepEqual(getAccentHistory(), ["#222222", "#444444", "#333333"]);
});

test("a preset never enters the history — it is already on the row above", () => {
  const before = getAccentHistory();
  for (const preset of PRESETS) rememberAccent(preset.hex);
  assert.deepEqual(getAccentHistory(), before, "three slots are too few to spend on a shortcut");

  // Including one typed out by hand rather than tapped: same colour, same redundant swatch.
  rememberAccent(PRESETS[0].hex.toUpperCase());
  assert.deepEqual(getAccentHistory(), before);
});
