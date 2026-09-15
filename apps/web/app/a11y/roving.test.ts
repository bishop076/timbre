import assert from "node:assert/strict";
import { test } from "node:test";

import { gridTarget, rovingTarget } from "./roving";

test("arrows move along the orientation they are given", () => {
  assert.equal(rovingTarget("ArrowRight", 0, 4, "horizontal"), 1);
  assert.equal(rovingTarget("ArrowLeft", 2, 4, "horizontal"), 1);
  assert.equal(rovingTarget("ArrowDown", 0, 4, "vertical"), 1);
  assert.equal(rovingTarget("ArrowUp", 2, 4, "vertical"), 1);
});

test("arrows across the grain are left for the page", () => {
  // The caller only calls preventDefault() when it gets an index back, so `null` here is what
  // keeps ArrowDown scrolling a page that happens to contain a horizontal shelf.
  assert.equal(rovingTarget("ArrowDown", 0, 4, "horizontal"), null);
  assert.equal(rovingTarget("ArrowUp", 2, 4, "horizontal"), null);
  assert.equal(rovingTarget("ArrowRight", 0, 4, "vertical"), null);
  assert.equal(rovingTarget("ArrowLeft", 2, 4, "vertical"), null);
});

test("both orientations take all four arrows", () => {
  assert.equal(rovingTarget("ArrowRight", 0, 4, "both"), 1);
  assert.equal(rovingTarget("ArrowDown", 0, 4, "both"), 1);
  assert.equal(rovingTarget("ArrowLeft", 1, 4, "both"), 0);
  assert.equal(rovingTarget("ArrowUp", 1, 4, "both"), 0);
});

test("Home and End work on any orientation", () => {
  assert.equal(rovingTarget("Home", 3, 4, "horizontal"), 0);
  assert.equal(rovingTarget("End", 0, 4, "vertical"), 3);
  assert.equal(rovingTarget("End", 0, 1, "both"), 0);
});

test("the ends are ends, so Tab can still leave the list", () => {
  assert.equal(rovingTarget("ArrowLeft", 0, 4, "horizontal"), null);
  assert.equal(rovingTarget("ArrowRight", 3, 4, "horizontal"), null);
  assert.equal(rovingTarget("ArrowUp", 0, 4, "vertical"), null);
  assert.equal(rovingTarget("ArrowDown", 3, 4, "vertical"), null);
});

test("keys we do not own are handed straight back", () => {
  for (const key of ["Enter", " ", "a", "Escape", "Tab", "PageDown"]) {
    assert.equal(rovingTarget(key, 1, 4, "both"), null, key);
  }
});

test("an empty list cannot be navigated", () => {
  assert.equal(rovingTarget("ArrowRight", 0, 0, "horizontal"), null);
  assert.equal(rovingTarget("Home", 0, 0, "horizontal"), null);
  assert.equal(rovingTarget("End", 0, 0, "horizontal"), null);
});

test("a grid's Up and Down move by a row, not by an item", () => {
  // 7 items, 3 across:  0 1 2 / 3 4 5 / 6
  assert.equal(gridTarget("ArrowDown", 1, 7, 3), 4);
  assert.equal(gridTarget("ArrowUp", 4, 7, 3), 1);
  assert.equal(gridTarget("ArrowRight", 2, 7, 3), 3);
  assert.equal(gridTarget("ArrowLeft", 3, 7, 3), 2);
});

test("a grid's short last row still catches a Down", () => {
  // Down from 5 would be 8, which does not exist — the end of the list is where it lands.
  assert.equal(gridTarget("ArrowDown", 5, 7, 3), 6);
  assert.equal(gridTarget("ArrowDown", 6, 7, 3), null);
  assert.equal(gridTarget("ArrowUp", 1, 7, 3), 0);
  assert.equal(gridTarget("ArrowUp", 0, 7, 3), null);
});

test("a grid answers Home and End, and nothing else", () => {
  assert.equal(gridTarget("Home", 5, 7, 3), 0);
  assert.equal(gridTarget("End", 0, 7, 3), 6);
  assert.equal(gridTarget("Enter", 0, 7, 3), null);
  assert.equal(gridTarget("ArrowDown", 0, 0, 3), null);
  assert.equal(gridTarget("ArrowDown", 0, 7, 0), null);
});
