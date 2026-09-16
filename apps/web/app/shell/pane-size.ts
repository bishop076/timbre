import { createJsonStore, createLocalStore, readJson, useLocalStore, writeJson } from "../local-store.ts";

/**
 * How wide the two side panes are, and the arithmetic a dragged edge needs.
 *
 * Everything here is a number in and a number out, with no DOM and no React, because the parts
 * worth getting wrong are all sums: where a drag lands, where a snap catches it, and how much
 * room is left for the column in the middle. The component that owns the pointer lives in
 * `resize-handle.tsx`; the panes themselves are in `sidebar.tsx` and `player/now-playing.tsx`.
 */

/** What the main column keeps for itself no matter how greedy a pane gets. Six tiles at a
 *  sensible size need about this much, and below it the shelves have nothing left to reflow. */
export const MAIN_MIN = 560;

/** One arrow key, and one arrow key with Shift held. */
export const PANE_STEP = 16;
export const PANE_PAGE = 64;

/** 4.5rem — the icon rail, unchanged from when it was a boolean. */
export const RAIL_ICONS = 72;
/** 13rem. The narrowest the rail goes *with words on it*: anything between this and the icon
 *  rail would be a label clipped mid-syllable, which is the thing the snap exists to prevent. */
export const RAIL_MIN = 208;
/** 19rem. 24 was wide enough that the rail started competing with the page for attention;
 *  the nav rows and the playlist list both fit comfortably well before it. */
export const RAIL_MAX = 304;
/** Let go of the edge left of here and the rail collapses to icons. Roughly halfway across the
 *  dead band, so the rail commits to one state or the other well before the pointer stops. */
export const RAIL_SNAP = 140;
/** 15rem — the width the labelled rail used to have, and so what a reset returns to. */
export const RAIL_WIDE = 240;

/** 18rem. Narrower than this and a queue row is all ellipsis. */
/**
 * 18rem. A compact panel, deliberately not a sliver: the artwork, the title and the top of the
 * queue are all still readable here. Dragging in lands on this rather than dismissing the panel —
 * hiding it is an explicit act, via the header chevron or the button in the player bar.
 */
export const PANEL_MIN = 288;

/**
 * Drag the panel narrower than it is allowed to be, and it collapses to its rail.
 *
 * The threshold IS the minimum, deliberately. It used to sit 50px below, which meant dragging
 * through a band where the panel had stopped resizing and had not yet collapsed — you hauled it
 * into dead space and nothing happened until it suddenly did. Now the panel resists down to
 * PANEL_MIN, and the first pixel past that is the collapse: one continuous gesture with one
 * decision point at the edge you can feel.
 *
 * The width is not written when this fires, so reopening restores the size last chosen rather
 * than the sliver the pointer was released at on the way past.
 */
export const PANEL_RAIL = 28;

/**
 * How far past the minimum you have to keep dragging before the panel gives up and collapses.
 *
 * Without it the panel hit its minimum and vanished in the same pixel — you were still pulling
 * and it was already gone, with no moment to stop at the smallest size you were allowed. This is
 * a detent: the panel sticks at PANEL_MIN through this much further travel, so reaching the limit
 * is something you feel before it becomes something you did.
 *
 * 120px, not the 56 it started at. 56 was still sensitive enough to collapse on a drag that had
 * only slightly overshot — a detent you can cross by accident is not a detent. This is a
 * deliberate shove, which is right for a gesture whose other outcome is "the panel disappears".
 */
export const PANEL_RESIST = 120;

/** Whether a drag that ended at `width` means "collapse to the rail". */
export function panelCollapsesAt(width: number): boolean {
  return Number.isFinite(width) && width < PANEL_MIN - PANEL_RESIST;
}

/**
 * What the panel should PAINT for a given drag, as opposed to what it will commit to.
 *
 * Three bands. Above the minimum it follows the pointer. Through the resistance band it holds at
 * the minimum — the pointer keeps moving, the panel does not. Past that it is the rail, and stays
 * the rail however much further you drag, so the gesture resolves under your hand rather than
 * following you into a size nothing was ever going to keep.
 */
export function panelPaintWidth(raw: number, ceiling: number): number {
  if (panelCollapsesAt(raw)) return PANEL_RAIL;
  return resolvePanelWidth(raw, ceiling);
}
/** 27.5rem. 35rem was wide enough to be a second page rather than a panel — at 1536 it took a
 *  third of the window, and the shelves beside it dropped a whole column to pay for it. */
export const PANEL_MAX = 440;
/** 23rem — the fixed width the now-playing panel had before it could be dragged. */
export const PANEL_DEFAULT = 368;


export function clampWidth(width: number, min: number, max: number): number {
  if (!Number.isFinite(width)) return min;
  return Math.max(min, Math.min(Math.max(max, min), Math.round(width)));
}

/** Tailwind's `xl`. Below it the now-playing panel floats over the page instead of sitting in
 *  the row, so it is taking no width from anyone. */
export const DOCK_MIN = 1280;

/** Tailwind's `lg`, and the rail's own `lg:flex`. Below it the rail is `display: none` — not
 *  narrow, gone — so it is no more part of the row than the floating panel is. */
export const RAIL_DOCK_MIN = 1024;

/** What the panel is costing the row right now, which is nothing at all while it floats. */
export function dockedPanelWidth(width: number, open: boolean, viewport: number): number {
  return open && viewport >= DOCK_MIN ? width : 0;
}

/**
 * What is left for one pane once the other pane and the smallest useful main column have been
 * paid for. Both panes ask this of each other, so neither can squeeze the shelves flat.
 *
 * `dockedAt` is the window width below which this pane is not in the row at all, and it is the
 * difference between a ceiling and a shredder. The answer here is not only painted: the handle
 * commits a width that no longer fits, and committing means writing it to storage. So a window
 * too narrow to lay the pane out — a phone, a half-screen window — was being asked what the row
 * could spare, answering "nothing", and saving that. Someone who widened their sidebar on a
 * desktop and then opened Timbre on their phone found it back to icons on the desktop, with
 * nothing on the phone ever having shown a sidebar at all. A pane that is not being laid out has
 * no width to give back.
 */
export function roomFor(
  viewport: number,
  taken: number,
  { max, floor, dockedAt }: { max: number; floor: number; dockedAt: number },
): number {
  if (!Number.isFinite(viewport) || viewport <= 0 || viewport < dockedAt) return max;
  return Math.max(floor, Math.min(max, Math.round(viewport - taken - MAIN_MIN)));
}

/**
 * Where the rail lands for a given dragged width. There is no such thing as a 150px rail: below
 * the snap it is the icon rail, above it the narrowest labelled rail, and nothing in between.
 * A ceiling too small to hold a labelled rail means icons are the only option left.
 */
export function resolveRailWidth(raw: number, ceiling = RAIL_MAX): number {
  if (!Number.isFinite(raw) || raw < RAIL_SNAP || ceiling < RAIL_MIN) return RAIL_ICONS;
  return clampWidth(raw, RAIL_MIN, ceiling);
}

/** True when the rail is showing icons only — the state the old boolean used to hold. */
export function railIsCollapsed(width: number): boolean {
  return width < RAIL_MIN;
}

export function resolvePanelWidth(raw: number, ceiling = PANEL_MAX): number {
  return clampWidth(raw, PANEL_MIN, ceiling);
}

/** A pointer that has moved `delta` px sideways. `direction` is +1 for a pane sitting to the
 *  left of its handle, where dragging right widens it, and -1 for one sitting to the right. */
export function widthFromDrag(start: number, delta: number, direction: 1 | -1): number {
  return start + delta * direction;
}

export type PaneKeys = {
  width: number;
  direction: 1 | -1;
  min: number;
  max: number;
  /** Where Enter and Space put the pane back to. */
  reset: number;
  resolve: (raw: number) => number;
};

/**
 * Arrow keys move the *handle*, not the pane: Right always means "this edge moves right",
 * whichever side the pane is on. Home and End send it as far as it goes in each direction,
 * which for the right-hand panel means Home makes it wider — the handle is what is moving.
 *
 * The retry loop is the snap's fault and is the whole reason this is not a one-liner. One step
 * off the icon rail resolves straight back to the icon rail, so a keyboard alone could never
 * cross the dead band; when a step changes nothing, the step doubles until something gives.
 */
export function widthForKey(key: string, shift: boolean, pane: PaneKeys): number | null {
  const { width, direction, min, max, reset, resolve } = pane;

  if (key === "Home") return resolve(direction === 1 ? min : max);
  if (key === "End") return resolve(direction === 1 ? max : min);
  if (key === "Enter" || key === " ") return resolve(reset);

  const step = (shift ? PANE_PAGE : PANE_STEP) * direction;
  const delta = key === "ArrowRight" ? step : key === "ArrowLeft" ? -step : 0;
  if (delta === 0) return null;

  const stepped = resolve(width + delta);
  if (stepped !== width) return stepped;

  const way = Math.sign(delta);
  const span = Math.abs(max - min) + Math.abs(delta);
  for (let jump = Math.abs(delta) * 2; jump <= span; jump *= 2) {
    const next = resolve(width + way * jump);
    if (next !== width) return next;
  }
  return null;
}

/**
 * The rail used to store a boolean under `timbre:rail-collapsed`, and those values are still in
 * people's browsers. Reading the old key here rather than starting over means a rail someone
 * expanded stays expanded across the change; a `true` maps to icons, which is also the default.
 */
export function parseRailWidth(stored: unknown): number {
  if (typeof stored === "boolean") return stored ? RAIL_ICONS : RAIL_WIDE;
  if (typeof stored !== "number") return RAIL_ICONS;
  return resolveRailWidth(stored);
}

export function parsePanelWidth(stored: unknown): number {
  if (typeof stored !== "number") return PANEL_DEFAULT;
  return resolvePanelWidth(stored);
}

const RAIL_KEY = "timbre:rail-width";
const RAIL_LEGACY_KEY = "timbre:rail-collapsed";

// `createJsonStore` reads one key, and there are two: the width, and the boolean the width
// replaces. This is that function with a second key in the `read`, built from the same pieces —
// same `timbre:` prefix, same JSON helpers, same cross-tab `storage` listener. `initial` stays a
// constant so the server and the first client render still agree on what to paint.
const railStore = createLocalStore<number>({
  initial: RAIL_ICONS,
  read: () => parseRailWidth(readJson(RAIL_KEY) ?? readJson(RAIL_LEGACY_KEY)),
  write: (value) => writeJson(RAIL_KEY, value),
  keys: [RAIL_KEY, RAIL_LEGACY_KEY],
});

const panelStore = createJsonStore("timbre:panel-width", PANEL_DEFAULT, parsePanelWidth);

export function useRailWidth(): number {
  return useLocalStore(railStore);
}

export function saveRailWidth(width: number): void {
  railStore.save(width);
}

export function usePanelWidth(): number {
  return useLocalStore(panelStore);
}

export function savePanelWidth(width: number): void {
  panelStore.save(width);
}
