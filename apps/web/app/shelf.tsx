"use client";

import { useEffect, useRef, useState } from "react";

import { ChevronIcon } from "./icons";

/**
 * A horizontal row of tiles with arrows.
 *
 * A discography is long — twenty-five releases is ordinary — and a grid of that
 * many covers turns an artist page into a wall to scroll past before reaching
 * anything else. A shelf keeps each section to one band of the page and hands
 * the length to a sideways scroll instead.
 *
 * The arrows appear **only when the row actually overflows**, and each disables
 * at its end. A control that is always visible but usually does nothing teaches
 * people to ignore it.
 *
 * There is a near-identical shelf inside `search-results.tsx`. It is private to
 * that file and that file is under active work by the other agent, so this is a
 * deliberate second copy rather than a refactor across a moving target — see
 * docs/WORKSTREAMS.md. Worth unifying once both settle.
 */
export function Shelf({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: React.ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  useEffect(() => {
    const el = row.current;
    if (!el) return;

    const measure = () => {
      // A pixel of slack: sub-pixel layout means scrollLeft rarely lands
      // exactly on the maximum, and a permanently-enabled arrow that does
      // nothing is worse than one that disables a pixel early.
      setCanLeft(el.scrollLeft > 1);
      setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    };

    measure();
    el.addEventListener("scroll", measure, { passive: true });
    // Covers late-loading covers changing the row's width, and the panel
    // opening or closing beside it.
    const observer = new ResizeObserver(measure);
    observer.observe(el);

    return () => {
      el.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [children]);

  /** Scrolls by most of a screenful, leaving one tile as a visual anchor. */
  function nudge(direction: 1 | -1) {
    row.current?.scrollBy({
      left: direction * (row.current.clientWidth * 0.8),
      behavior: "smooth",
    });
  }

  return (
    <section className="mb-9">
      <div className="mb-3.5 flex items-center justify-between gap-4 px-1">
        <h2 className="text-xl font-extrabold tracking-tight">{title}</h2>

        <div className="flex shrink-0 items-center gap-2">
          {caption && (
            <p className="slab-sm hidden rounded-[var(--r-full)] bg-[var(--surface-2)] px-2.5 py-1 text-[11px] font-semibold text-[var(--fg-dim)] @md:block">
              {caption}
            </p>
          )}
          {(canLeft || canRight) && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => nudge(-1)}
                disabled={!canLeft}
                aria-label={`Scroll ${title} left`}
                className="slab-sm press flex size-7 items-center justify-center rounded-[var(--r-full)] bg-[var(--surface-2)] text-[var(--fg)] transition-opacity disabled:opacity-30"
              >
                <ChevronIcon className="size-4 rotate-90" />
              </button>
              <button
                type="button"
                onClick={() => nudge(1)}
                disabled={!canRight}
                aria-label={`Scroll ${title} right`}
                className="slab-sm press flex size-7 items-center justify-center rounded-[var(--r-full)] bg-[var(--surface-2)] text-[var(--fg)] transition-opacity disabled:opacity-30"
              >
                <ChevronIcon className="size-4 -rotate-90" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* `scroll-pl-1` matches `px-1` above: without it the browser snaps the
          first tile to the raw scroll origin inside the padding, and the row
          starts silently offset by exactly the padding width. */}
      <div className="shelf flex snap-x snap-proximity gap-4 overflow-x-auto scroll-pl-1 px-1 pb-1">
        {children}
      </div>
    </section>
  );
}
