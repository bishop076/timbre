"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

export function useAnchoredMenu(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  menu: RefObject<HTMLElement | null>,
  width: number,
  remeasure?: unknown,
): { left: number; top: number } | null {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;

      const MARGIN = 8;

      const wantLeft = rect.right - width;
      const left = Math.min(
        Math.max(MARGIN, wantLeft < MARGIN ? rect.left : wantLeft),
        Math.max(MARGIN, window.innerWidth - width - MARGIN),
      );

      const height = menu.current?.offsetHeight ?? 0;
      const below = window.innerHeight - rect.bottom;

      const fitsBelow = height + MARGIN <= below;
      const top = fitsBelow || below >= rect.top ? rect.bottom + 6 : rect.top - 6 - height;
      const maxTop = Math.max(MARGIN, window.innerHeight - height - MARGIN);

      const next = { left, top: Math.min(Math.max(MARGIN, top), maxTop) };

      setAt((prev) => (prev && prev.left === next.left && prev.top === next.top ? prev : next));
    };

    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, anchor, menu, width, remeasure]);

  return open ? at : null;
}
