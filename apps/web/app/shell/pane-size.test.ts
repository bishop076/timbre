import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clampWidth,
  dockedPanelWidth,
  MAIN_MIN,
  PANEL_DEFAULT,
  PANEL_MAX,
  PANEL_CLOSE_AT,
  PANEL_MIN,
  parsePanelWidth,
  parseRailWidth,
  railIsCollapsed,
  RAIL_ICONS,
  RAIL_MAX,
  RAIL_MIN,
  RAIL_SNAP,
  RAIL_WIDE,
  panelClosesAt,
  resolvePanelWidth,
  resolveRailWidth,
  roomFor,
  widthForKey,
  widthFromDrag,
} from "./pane-size.ts";

const railKeys = (width: number) => ({
  width,
  direction: 1 as const,
  min: RAIL_ICONS,
  max: RAIL_MAX,
  reset: RAIL_WIDE,
  resolve: (raw: number) => resolveRailWidth(raw),
});

const panelKeys = (width: number) => ({
  width,
  direction: -1 as const,
  min: PANEL_MIN,
  max: PANEL_MAX,
  reset: PANEL_DEFAULT,
  resolve: (raw: number) => resolvePanelWidth(raw),
});

test("a width is clamped to whole pixels inside its range", () => {
  assert.equal(clampWidth(300.4, 100, 500), 300);
  assert.equal(clampWidth(20, 100, 500), 100);
  assert.equal(clampWidth(900, 100, 500), 500);
  assert.equal(clampWidth(Number.NaN, 100, 500), 100);
});

test("a ceiling below the floor still returns something usable", () => {
  assert.equal(clampWidth(400, 100, 50), 100);
});

test("dragging right widens a pane on the left and narrows one on the right", () => {
  assert.equal(widthFromDrag(200, 60, 1), 260);
  assert.equal(widthFromDrag(200, 60, -1), 140);
  assert.equal(widthFromDrag(200, -60, -1), 260);
});

test("the rail has no width between icons and words", () => {
  assert.equal(resolveRailWidth(RAIL_SNAP - 1), RAIL_ICONS);
  assert.equal(resolveRailWidth(RAIL_SNAP), RAIL_MIN, "past the snap it jumps to a full label");
  assert.equal(resolveRailWidth(RAIL_MIN - 1), RAIL_MIN);
  assert.equal(resolveRailWidth(260), 260);
  assert.equal(resolveRailWidth(9000), RAIL_MAX);
});

test("a ceiling too small for a labelled rail leaves only icons", () => {
  assert.equal(resolveRailWidth(300, RAIL_MIN - 1), RAIL_ICONS);
  assert.equal(resolveRailWidth(300, 250), 250);
});

test("collapsed means icons, whatever the number is", () => {
  assert.ok(railIsCollapsed(RAIL_ICONS));
  assert.ok(railIsCollapsed(RAIL_MIN - 1));
  assert.ok(!railIsCollapsed(RAIL_MIN));
  assert.ok(!railIsCollapsed(RAIL_WIDE));
});

test("the panel clamps rather than snaps", () => {
  assert.equal(resolvePanelWidth(10), PANEL_MIN);
  assert.equal(resolvePanelWidth(400), 400);
  assert.equal(resolvePanelWidth(9000), PANEL_MAX);
  assert.equal(resolvePanelWidth(9000, 420), 420);
});

test("neither pane may eat the main column", () => {
  // 1536x690 with the icon rail: the panel can have its full range.
  assert.equal(roomFor(1536, RAIL_ICONS, { max: PANEL_MAX, floor: PANEL_MIN }), PANEL_MAX);
  // A shorter window with the rail dragged wide: the panel loses the difference.
  assert.equal(roomFor(1400, RAIL_MAX, { max: PANEL_MAX, floor: PANEL_MIN }), 1400 - RAIL_MAX - MAIN_MIN);
  // A narrow laptop with a wide panel: the rail is held to what is left.
  assert.equal(roomFor(1280, 480, { max: RAIL_MAX, floor: RAIL_ICONS }), 1280 - 480 - MAIN_MIN);
  // And when there is nothing left, the floor holds rather than going negative.
  assert.equal(roomFor(700, 400, { max: RAIL_MAX, floor: RAIL_ICONS }), RAIL_ICONS);
});

test("a floating panel takes no room from the rail", () => {
  assert.equal(dockedPanelWidth(368, true, 1536), 368);
  assert.equal(dockedPanelWidth(368, true, 1100), 0, "below xl the panel floats over the page");
  assert.equal(dockedPanelWidth(368, false, 1536), 0);
});

test("arrow keys move the handle, not the pane", () => {
  assert.equal(widthForKey("ArrowRight", false, railKeys(240)), 256);
  assert.equal(widthForKey("ArrowLeft", false, railKeys(240)), 224);
  // Same two keys on the right-hand panel move the same way on screen, so Right narrows it.
  assert.equal(widthForKey("ArrowRight", false, panelKeys(368)), 352);
  assert.equal(widthForKey("ArrowLeft", false, panelKeys(368)), 384);
});

test("Shift takes a bigger step", () => {
  assert.equal(widthForKey("ArrowRight", true, railKeys(240)), 304);
});

test("keys that are not a resize are left to the page", () => {
  assert.equal(widthForKey("a", false, railKeys(240)), null);
  assert.equal(widthForKey("ArrowUp", false, railKeys(240)), null);
  assert.equal(widthForKey("Tab", false, panelKeys(368)), null);
});

test("Home and End send the handle to each end of its travel", () => {
  assert.equal(widthForKey("Home", false, railKeys(240)), RAIL_ICONS);
  assert.equal(widthForKey("End", false, railKeys(240)), RAIL_MAX);
  // The panel's handle is on its left, so Home — as far left as it goes — makes it widest.
  assert.equal(widthForKey("Home", false, panelKeys(368)), PANEL_MAX);
  assert.equal(widthForKey("End", false, panelKeys(368)), PANEL_MIN);
});

test("Enter and Space put a pane back", () => {
  assert.equal(widthForKey("Enter", false, railKeys(RAIL_MAX)), RAIL_WIDE);
  assert.equal(widthForKey(" ", false, panelKeys(PANEL_MAX)), PANEL_DEFAULT);
});

test("a keyboard can cross the rail's snap in both directions", () => {
  // One 16px step off the icon rail resolves straight back to the icon rail. If the step did
  // not grow, the rail would be keyboard-collapsible and never keyboard-expandable.
  assert.equal(widthForKey("ArrowRight", false, railKeys(RAIL_ICONS)), RAIL_MIN);
  assert.equal(widthForKey("ArrowLeft", false, railKeys(RAIL_MIN)), RAIL_ICONS);
});

test("a key that cannot move anything reports so, and does not loop forever", () => {
  assert.equal(widthForKey("ArrowLeft", false, railKeys(RAIL_ICONS)), null);
  assert.equal(widthForKey("ArrowRight", false, railKeys(RAIL_MAX)), null);
  assert.equal(widthForKey("ArrowRight", false, panelKeys(PANEL_MIN)), null);
});

test("the rail's old boolean is read as a width rather than crashing", () => {
  assert.equal(parseRailWidth(true), RAIL_ICONS, "collapsed: true was the icon rail");
  assert.equal(parseRailWidth(false), RAIL_WIDE, "collapsed: false was the 15rem rail");
  assert.equal(parseRailWidth(null), RAIL_ICONS);
  assert.equal(parseRailWidth("240"), RAIL_ICONS);
  assert.equal(parseRailWidth({ width: 240 }), RAIL_ICONS);
  assert.equal(parseRailWidth(260), 260);
  assert.equal(parseRailWidth(160), RAIL_MIN, "a stored width still has to be a legal one");
});

test("a stored panel width is clamped on the way in", () => {
  assert.equal(parsePanelWidth(400), 400);
  assert.equal(parsePanelWidth(20), PANEL_MIN);
  assert.equal(parsePanelWidth("wide"), PANEL_DEFAULT);
  assert.equal(parsePanelWidth(null), PANEL_DEFAULT);
});

test("dragging the panel past its low end means close, not narrower", () => {
  // The rail snaps to icons at its low end. The panel has no icon form — a queue at 240px is not
  // a smaller queue, it is an unreadable one — so its low end is "gone". That is also what makes
  // the drag a way to dismiss the panel rather than only a way to size it.
  assert.equal(panelClosesAt(PANEL_CLOSE_AT - 1), true);
  assert.equal(panelClosesAt(PANEL_CLOSE_AT), false);
  assert.equal(panelClosesAt(PANEL_MIN), false);
  assert.equal(panelClosesAt(PANEL_DEFAULT), false);

  // Not a number is not a close. A drag that produced NaN should leave the panel alone rather
  // than dismissing it.
  assert.equal(panelClosesAt(Number.NaN), false);
  assert.equal(panelClosesAt(Number.POSITIVE_INFINITY), false);
});

test("the close threshold sits below the minimum, so it can only be reached deliberately", () => {
  // If these ever crossed, every drag to the minimum would dismiss the panel instead of resting
  // at it, and the panel would be impossible to size small.
  assert.ok(
    PANEL_CLOSE_AT < PANEL_MIN,
    `close at ${PANEL_CLOSE_AT} must be under the minimum ${PANEL_MIN}`,
  );
});
