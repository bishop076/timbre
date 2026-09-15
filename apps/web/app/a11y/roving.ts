/**
 * Which item an arrow key should move to — the whole of the decision, with no DOM in it, so it
 * can be tested by `node --test` rather than reasoned about.
 *
 * `null` means "this key is not ours": the caller must then leave the event alone, because a key
 * we neither use nor hand back is a key the page has lost. Everything we do claim is
 * `preventDefault()`-ed by the caller, which is the point — an ArrowDown that moves focus *and*
 * scrolls the page moves the thing you were looking at out from under you.
 */
export type Orientation = "horizontal" | "vertical" | "both" | "grid";

const NEXT = new Set(["ArrowRight", "ArrowDown"]);
const PREVIOUS = new Set(["ArrowLeft", "ArrowUp"]);

function usesKey(key: string, orientation: Orientation): boolean {
  if (orientation === "both") return NEXT.has(key) || PREVIOUS.has(key);
  const axis = orientation === "horizontal" ? ["ArrowRight", "ArrowLeft"] : ["ArrowDown", "ArrowUp"];
  return axis.includes(key);
}

export function rovingTarget(
  key: string,
  from: number,
  count: number,
  orientation: Orientation = "horizontal",
): number | null {
  if (count <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (!usesKey(key, orientation)) return null;

  // Deliberately not wrapping. In a shelf that scrolls, tabbing off the end and looping back to
  // the start reads as the focus having been thrown somewhere; stopping at the edge lets Tab do
  // what Tab is for and leave the list.
  const step = NEXT.has(key) ? 1 : -1;
  const to = from + step;
  if (to < 0 || to >= count) return null;
  return to;
}

/**
 * The same decision for a wrapped grid, where Up and Down mean "one row", not "one item".
 *
 * Off the top or bottom edge it clamps to the first or last item rather than giving up, because
 * a grid's last row is usually short: ArrowDown from the third column of the second-to-last row
 * has to land somewhere, and the end of the list is the only honest answer.
 */
export function gridTarget(
  key: string,
  from: number,
  count: number,
  columns: number,
): number | null {
  if (count <= 0 || columns <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowRight") return from + 1 < count ? from + 1 : null;
  if (key === "ArrowLeft") return from > 0 ? from - 1 : null;
  if (key === "ArrowDown") {
    if (from + columns < count) return from + columns;
    return from === count - 1 ? null : count - 1;
  }
  if (key === "ArrowUp") {
    if (from - columns >= 0) return from - columns;
    return from === 0 ? null : 0;
  }
  return null;
}
