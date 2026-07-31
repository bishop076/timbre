"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Timbre's own scrollbar.
 *
 * Drawn rather than styled, after three attempts to make the browser's fit.
 * The native bar is a moving target: Chrome ignores every `::-webkit-scrollbar`
 * rule the moment `scrollbar-width` is set, the standard properties allow a
 * colour and a coarse width and nothing else, and Windows, macOS and Linux each
 * render the result differently — overlay on some, space-taking on others. None
 * of it can be made to match an interface built out of hard borders and offset
 * shadows.
 *
 * So the native bar is hidden and this takes over: an element positioned from
 * `scrollTop`, `scrollHeight` and `clientHeight`. Identical everywhere, themed
 * from the same tokens as everything else, and draggable.
 *
 * It **overlays** rather than reserving a gutter, so nothing shifts when a page
 * becomes scrollable, and it hides itself entirely when there is nothing to
 * scroll — the case where a permanent bar is pure noise.
 */
export function ScrollThumb({ target }: { target: React.RefObject<HTMLElement | null> }) {
  const [thumb, setThumb] = useState<{ top: number; height: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef({ startY: 0, startScroll: 0 });

  useEffect(() => {
    const el = target.current;
    if (!el) return;

    const measure = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const overflow = scrollHeight - clientHeight;

      // A page that does not scroll gets no scrollbar at all.
      if (overflow <= 1) {
        setThumb(null);
        return;
      }

      // Proportional, with a floor: on a very long page the true proportion
      // would be a few pixels tall and impossible to grab.
      const height = Math.max(32, (clientHeight / scrollHeight) * clientHeight);
      const top = (scrollTop / overflow) * (clientHeight - height);
      setThumb({ top, height });
    };

    el.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    // Content growing without the container resizing — a search finishing, a
    // shelf arriving — has to move the thumb too.
    const mutations = new MutationObserver(measure);
    mutations.observe(el, { childList: true, subtree: true });

    return () => {
      el.removeEventListener("scroll", measure);
      observer.disconnect();
      mutations.disconnect();
    };
  }, [target]);

  useEffect(() => {
    if (!dragging) return;

    const el = target.current;
    if (!el) return;

    const onMove = (event: PointerEvent) => {
      const overflow = el.scrollHeight - el.clientHeight;
      const height = Math.max(32, (el.clientHeight / el.scrollHeight) * el.clientHeight);
      const travel = el.clientHeight - height;
      if (travel <= 0) return;
      // Movement is scaled by the ratio of scrollable distance to thumb travel,
      // so the content keeps pace with the pointer exactly.
      const delta = ((event.clientY - drag.current.startY) / travel) * overflow;
      el.scrollTop = drag.current.startScroll + delta;
    };

    const stop = () => setDragging(false);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [dragging, target]);

  if (!thumb) return null;

  return (
    <div
      role="presentation"
      onPointerDown={(event) => {
        const el = target.current;
        if (!el) return;
        event.preventDefault();
        drag.current = { startY: event.clientY, startScroll: el.scrollTop };
        setDragging(true);
      }}
      style={{ top: thumb.top, height: thumb.height }}
      className={`absolute right-1 z-30 w-1.5 cursor-grab rounded-[var(--r-full)] transition-colors ${
        dragging
          ? "cursor-grabbing bg-[var(--accent)]"
          : "bg-[color-mix(in_oklab,var(--fg)_28%,transparent)] hover:bg-[var(--accent)]"
      }`}
    />
  );
}
