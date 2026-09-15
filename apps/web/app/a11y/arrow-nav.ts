"use client";

import { scrollBehavior } from "./motion";
import { gridTarget, rovingTarget, type Orientation } from "./roving";

const FOCUSABLE = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Controls that own their own arrow keys. A shelf sitting above a volume slider must not steal
 * the Left that is trying to turn it down, and the browser's own Left/Right inside a text field
 * moves the caret.
 */
const SELF_GOVERNING = '[role="slider"],[role="tab"],[role="menu"],[role="menuitem"],[role="listbox"],[role="option"]';

function isTyping(node: HTMLElement): boolean {
  const tag = node.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return node.isContentEditable;
}

/** The first thing inside `item` a keyboard can land on — the item itself, if it is that thing. */
export function firstFocusableIn(item: HTMLElement): HTMLElement | null {
  if (item.matches(FOCUSABLE)) return item;
  return item.querySelector<HTMLElement>(FOCUSABLE);
}

/**
 * How many items a row of a wrapped grid holds, read off the layout rather than off the class
 * names. `grid-cols-2 @md:grid-cols-3 @2xl:grid-cols-4` is three different answers depending on
 * how wide the panel is, and only the browser knows which one is true right now.
 */
function columnsOf(items: HTMLElement[]): number {
  const top = items[0]?.offsetTop;
  if (top === undefined) return 1;
  const columns = items.findIndex((item) => item.offsetTop > top);
  return columns <= 0 ? items.length : columns;
}

/**
 * Arrow-key movement across the children of `container`, driven by a key event raised inside one
 * of them.
 *
 * Returns whether it took the key. When it does it has already called `preventDefault()`, so the
 * page does not scroll underneath the move — that pairing is the whole reason this exists, and
 * splitting it up is how one of the two gets forgotten.
 */
export function moveBetweenItems(
  event: React.KeyboardEvent,
  container: HTMLElement | null,
  orientation: Orientation,
): boolean {
  if (!container || event.defaultPrevented) return false;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;

  const target = event.target as HTMLElement | null;
  if (!target || isTyping(target) || target.closest(SELF_GOVERNING)) return false;

  const items = [...container.children].filter(
    (child): child is HTMLElement => child instanceof HTMLElement && firstFocusableIn(child) !== null,
  );
  const from = items.findIndex((item) => item.contains(target));
  if (from < 0) return false;

  const to =
    orientation === "grid"
      ? gridTarget(event.key, from, items.length, columnsOf(items))
      : rovingTarget(event.key, from, items.length, orientation);
  if (to === null || to === from) return false;

  const landing = firstFocusableIn(items[to]!);
  if (!landing) return false;

  event.preventDefault();
  event.stopPropagation();
  // `preventScroll` then a scroll of our own: the default would jump the nearest scroll port to
  // wherever it likes, and a shelf wants the tile brought to its edge, not centred.
  landing.focus({ preventScroll: true });
  items[to]!.scrollIntoView({
    behavior: scrollBehavior(),
    block: "nearest",
    inline: "nearest",
  });
  return true;
}
