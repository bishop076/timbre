"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

const WIDTH = 240;
const MARGIN = 8;
const UNPLACED: CSSProperties = { left: 0, top: 0, visibility: "hidden" };

export function useAnchoredMenu(remeasure?: unknown, width = WIDTH) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      const rect = root.current?.getBoundingClientRect();
      if (!rect) return;

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
  }, [open, remeasure, width]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !menu.current?.contains(target)) close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close(true);
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  const placed = open ? at : null;
  return { open, setOpen, close, root, trigger, menu, placed, style: placed ?? UNPLACED };
}
