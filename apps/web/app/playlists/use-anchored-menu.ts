"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Places a `position: fixed` menu against a trigger, clamped to the viewport.
 *
 * Both playlist menus need this and only one of them had it. `<AddToPlaylist>` grew the
 * logic because a shelf is `overflow-x: auto` and an absolutely positioned child of a
 * scroll container is clipped by it; `<PlaylistActions>` stayed `absolute left-0` and was
 * badly wrong in the place it is used most. Its trigger sits in the corner of a playlist
 * card, and the card on a phone is about 173px against a 240px menu — so `left-0` ran three
 * quarters of the menu off the right of the screen in the second column, and flipping to
 * `right-0` would only have moved the same problem to the left edge in the first. No fixed
 * alignment can work when the menu is wider than the thing it hangs off; it has to be
 * measured against the window.
 *
 * Fixed rather than absolute is what escapes the clipping — `overflow: hidden` on an
 * ancestor does not clip a fixed descendant — so no portal is needed here, but the position
 * has to be recomputed on scroll, which is why the listeners are capturing.
 *
 * Returns `null` until it has measured. Render the menu anyway while it is null, hidden:
 * the height below is read off the real element, and an element that is not in the DOM has
 * none. Both effects run before paint, so the unplaced frame is never shown.
 */
export function useAnchoredMenu(
  open: boolean,
  /** The trigger's wrapper. Its rect is what the menu hangs from. */
  anchor: RefObject<HTMLElement | null>,
  /** The menu itself, measured for its real height once it exists. */
  menu: RefObject<HTMLElement | null>,
  width: number,
  /**
   * Anything that changes the menu's height while it stays open. Scroll and resize are
   * watched already; this covers the menu rewriting its own contents, which no listener
   * sees — <PlaylistActions> swaps between a list, a rename field and a confirmation.
   */
  remeasure?: unknown,
): { left: number; top: number } | null {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  // `useLayoutEffect` so the menu never appears at the wrong place first.
  useLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;

      const MARGIN = 8;

      // Right edges aligned by preference, left edges if that would not fit, and clamped to
      // the window either way — which is the case a card in a two-column grid always hits.
      const wantLeft = rect.right - width;
      const left = Math.min(
        Math.max(MARGIN, wantLeft < MARGIN ? rect.left : wantLeft),
        Math.max(MARGIN, window.innerWidth - width - MARGIN),
      );

      // Measured, not guessed: these menus change height with their contents — a playlist
      // list is shorter than its maximum until it fills, and the actions menu swaps between
      // its list, a rename field and a delete confirmation.
      const height = menu.current?.offsetHeight ?? 0;
      const below = window.innerHeight - rect.bottom;

      // Above only when it genuinely fits better there, then clamped for the window too
      // short for either side. Being fixed, whatever hangs off cannot be scrolled to.
      const fitsBelow = height + MARGIN <= below;
      const top = fitsBelow || below >= rect.top ? rect.bottom + 6 : rect.top - 6 - height;
      const maxTop = Math.max(MARGIN, window.innerHeight - height - MARGIN);

      const next = { left, top: Math.min(Math.max(MARGIN, top), maxTop) };

      // Identity-stable, because this runs again the moment it has a height to measure and
      // a fresh object every time would re-render for as long as the menu stayed open.
      setAt((prev) => (prev && prev.left === next.left && prev.top === next.top ? prev : next));
    };

    place();
    // Capturing, so a scroll in any ancestor is seen, not only one on the window.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, anchor, menu, width, remeasure]);

  // Gated on `open` rather than cleared when it closes: clearing would be a `setState`
  // straight inside the effect, which `react-hooks/set-state-in-effect` rejects — rightly,
  // since the stale value is derivable and a second render is not needed to forget it.
  return open ? at : null;
}
