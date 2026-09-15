"use client";

import { useEffect, useRef, useState } from "react";

import { widthForKey, widthFromDrag } from "./pane-size.ts";

/**
 * The window's width, or 0 before there is a window. Both panes size themselves against it — a
 * pane may only take what the main column can spare — and `roomFor` reads a 0 as "no ceiling
 * known yet", so the server and the first client render agree on the pane's full range.
 */
export function useViewportWidth(): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const measure = () => setWidth(window.innerWidth);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  return width;
}

/** Undo everything a drag does to the page outside the pane. Also the unmount path: a handle
 *  that disappears mid-drag — the panel closing under you — must not leave the page unselectable. */
function release(): void {
  document.documentElement.removeAttribute("data-resizing");
  document.body.style.removeProperty("user-select");
  document.body.style.removeProperty("cursor");
}

/**
 * The draggable edge of a side pane — one component for the rail on the left and the now-playing
 * panel on the right, because the only thing that differs between them is which way "wider" is.
 *
 * It is a `separator` with a tabindex, which is the window-splitter pattern: a focusable divider
 * that reports where it sits between two panes. Arrow keys move it, Home and End send it to
 * either end, Enter puts it back where it started, and a double-click does the same with a
 * mouse. Without that a resize is a pointer-only feature, and half the app becomes unreachable
 * for anyone who cannot drag.
 *
 * While a drag is live the width is written straight onto the pane as a custom property rather
 * than through React. Re-rendering the rail — playlists, queue and all — on every pointermove
 * drops frames, and the committed value only matters when the pointer comes up. `data-resizing`
 * on the root is how the pane's own width transition gets out of the way for the same reason:
 * a 300ms ease is right for opening and closing, and is lag for dragging.
 */
export function ResizeHandle({
  controls,
  label,
  variable,
  width,
  min,
  max,
  reset,
  direction,
  resolve,
  onCommit,
  className = "",
}: {
  /** The id of the pane this edge belongs to. Also how the handle finds it to paint. */
  controls: string;
  label: string;
  /** The custom property the pane's width reads from, e.g. `--rail-w`. */
  variable: string;
  width: number;
  min: number;
  max: number;
  reset: number;
  /** +1 for a pane left of its handle, where dragging right widens it. -1 for one on the right. */
  direction: 1 | -1;
  /** Clamps and snaps a dragged width to one the pane will actually take. */
  resolve: (raw: number) => number;
  onCommit: (width: number) => void;
  className?: string;
}) {
  const self = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; from: number; at: number; width: number } | null>(null);
  // The two below are called from an effect that must not re-run when they change identity,
  // which they do on every render. Held in a ref, refreshed in an effect of their own so the
  // fitting effect underneath — declared second, so it runs second — always sees the current pair.
  const latest = useRef({ resolve, onCommit });

  useEffect(() => {
    latest.current = { resolve, onCommit };
  });

  useEffect(() => release, []);

  // A pane that no longer fits gives the width back. Without this, shrinking the window leaves a
  // panel wider than the room it was allowed, and nothing puts it right until someone drags it.
  useEffect(() => {
    const fitted = latest.current.resolve(width);
    if (fitted !== width) latest.current.onCommit(fitted);
  }, [width, min, max]);

  /** Straight to the DOM: the pane's width and the value a screen reader would read out. React
   *  owns both again on the next commit, which is the one `onCommit` causes. */
  function paint(next: number): void {
    document.getElementById(controls)?.style.setProperty(variable, `${next}px`);
    self.current?.setAttribute("aria-valuenow", String(next));
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    drag.current = { id: event.pointerId, from: width, at: event.clientX, width };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.documentElement.setAttribute("data-resizing", "");
    // The pointer is captured, so the drag itself is safe, but without these the page selects
    // text under it and the cursor flickers back to an arrow over every link it passes.
    document.body.style.setProperty("user-select", "none");
    document.body.style.setProperty("cursor", "col-resize");
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    state.width = resolve(widthFromDrag(state.from, event.clientX - state.at, direction));
    paint(state.width);
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>): void {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    release();
    onCommit(state.width);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const next = widthForKey(event.key, event.shiftKey, {
      width,
      direction,
      min,
      max,
      reset,
      resolve,
    });
    if (next === null) return;
    // Taken even when the width does not change, because the alternative for an arrow key is
    // scrolling the page out from under the thing being resized.
    event.preventDefault();
    if (next !== width) onCommit(next);
  }

  return (
    <div
      ref={self}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={label}
      aria-controls={controls}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={`${width} pixels`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onCommit(resolve(reset))}
      // Zero height of its own: it stretches to whatever it is pinned inside, so a 690px window
      // loses nothing to it. The line is the only thing you see, and only once you are on it.
      className={`group absolute z-30 w-2 cursor-col-resize touch-none select-none outline-none ${className}`}
    >
      <span className="pointer-events-none absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 rounded-[var(--r-full)] bg-[var(--accent)] opacity-0 transition-opacity duration-150 group-hover:opacity-60 group-focus-visible:opacity-100 [[data-resizing]_&]:opacity-100" />
    </div>
  );
}
