import assert from "node:assert/strict";
import { test } from "node:test";

import { menuTarget, tabTarget, typeaheadQuery, typeaheadTarget, TYPEAHEAD_MS } from "./menu-keys";

test("arrows step through the items", () => {
  assert.equal(menuTarget("ArrowDown", 0, 4), 1);
  assert.equal(menuTarget("ArrowUp", 2, 4), 1);
  assert.equal(menuTarget("Home", 3, 4), 0);
  assert.equal(menuTarget("End", 0, 4), 3);
});

test("a menu wraps where a shelf stops", () => {
  // The difference from `rovingTarget`, and the only one. A menu is modal: an ArrowDown that
  // did nothing at the last item would read as the key being broken, since there is no next
  // thing outside for it to have moved to.
  assert.equal(menuTarget("ArrowDown", 3, 4), 0);
  assert.equal(menuTarget("ArrowUp", 0, 4), 3);
});

test("focus on the menu itself opens at the near end", () => {
  assert.equal(menuTarget("ArrowDown", -1, 4), 0);
  assert.equal(menuTarget("ArrowUp", -1, 4), 3);
});

test("keys the menu does not use are handed back", () => {
  // Left and Right are the page's, and inside a menu holding a text field they are the caret's.
  assert.equal(menuTarget("ArrowLeft", 1, 4), null);
  assert.equal(menuTarget("ArrowRight", 1, 4), null);
  assert.equal(menuTarget("Escape", 1, 4), null);
  assert.equal(menuTarget("a", 1, 4), null);
  assert.equal(menuTarget("ArrowDown", 0, 0), null);
});

test("an index past the end is treated as no index", () => {
  // Items can go while focus is elsewhere — a playlist picture is removed, its item unmounts.
  assert.equal(menuTarget("ArrowDown", 9, 3), 0);
  assert.equal(menuTarget("ArrowUp", 9, 3), 2);
});

test("typing builds a query and a pause clears it", () => {
  assert.equal(typeaheadQuery("", "p", 10_000), "p");
  assert.equal(typeaheadQuery("p", "l", 120), "pl");
  assert.equal(typeaheadQuery("p", "l", TYPEAHEAD_MS + 1), "l");
});

test("Space presses the item until a word is under way", () => {
  assert.equal(typeaheadQuery("", " ", 50), null);
  assert.equal(typeaheadQuery("add", " ", 50), "add ");
});

test("keys that are not characters do not type", () => {
  assert.equal(typeaheadQuery("", "Enter", 50), null);
  assert.equal(typeaheadQuery("", "ArrowDown", 50), null);
  assert.equal(typeaheadQuery("", "Escape", 50), null);
});

const ITEMS = ["Play now", "Play next", "Add to queue", "Add to playlist", "Like"];

test("a letter finds the next item starting with it", () => {
  assert.equal(typeaheadTarget("l", ITEMS, -1), 4);
  assert.equal(typeaheadTarget("a", ITEMS, 0), 2);
});

test("the same letter again steps to the next match and wraps", () => {
  assert.equal(typeaheadTarget("p", ITEMS, -1), 0);
  assert.equal(typeaheadTarget("pp", ITEMS, 0), 1);
  assert.equal(typeaheadTarget("ppp", ITEMS, 1), 0);
});

test("a longer query re-tests the item it is already on", () => {
  // "a" landed on "Add to queue"; typing "d" must not skip it for "Add to playlist".
  assert.equal(typeaheadTarget("ad", ITEMS, 2), 2);
  assert.equal(typeaheadTarget("add to p", ITEMS, 2), 3);
});

test("a query nothing starts with moves nothing", () => {
  assert.equal(typeaheadTarget("z", ITEMS, 0), null);
  assert.equal(typeaheadTarget("", ITEMS, 0), null);
  assert.equal(typeaheadTarget("p", [], 0), null);
});

test("labels are matched by their words, not their markup", () => {
  // `textContent` of an item is two spans and the whitespace between them.
  assert.equal(typeaheadTarget("s", ["\n  Spreadsheet (CSV)\n  To read elsewhere.\n"], -1), 0);
  assert.equal(typeaheadTarget("c", ITEMS, 0), null);
});

test("matching ignores case in both directions", () => {
  assert.equal(typeaheadTarget("P", ITEMS, -1), 0);
  assert.equal(typeaheadTarget("l", ["LIKE"], -1), 0);
});

test("Tab wraps in both directions rather than leaving", () => {
  assert.equal(tabTarget(0, 3, false), 1);
  assert.equal(tabTarget(2, 3, false), 0);
  assert.equal(tabTarget(0, 3, true), 2);
  assert.equal(tabTarget(-1, 3, false), 0);
  assert.equal(tabTarget(-1, 3, true), 2);
  assert.equal(tabTarget(0, 0, false), null);
});
