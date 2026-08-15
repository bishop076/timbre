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
 * The arrows are always drawn and each disables at its end — see the note on
 * them below for why that beat showing them only once a row measured as
 * overflowing.
 *
 * This is the only shelf. `search-results.tsx` had a private near-copy, kept
 * deliberately while both files were moving; it carried the two bugs this one
 * documents fixing (arrows absent on first paint, and a `scrollBy` that fought
 * scroll-snap), so unifying was a fix rather than a tidy-up.
 */
export function Shelf({
  title,
  caption,
  resetKey,
  children,
}: {
  title: string;
  caption?: string;
  /**
   * Changes when the row's *first* item changes, sending it back to the start.
   *
   * `overflow-anchor: none` on `.shelf` stops the browser fighting a prepend,
   * but a row the reader had already scrolled would still be left mid-way with
   * the newest item behind them. Only shelves whose head genuinely changes pass
   * this — "Recently played" does, a chart does not.
   */
  resetKey?: string;
  children: React.ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  // Assumed scrollable until measured otherwise: a shelf almost always is, and
  // guessing the other way is what left the arrows missing on first paint.
  const [canRight, setCanRight] = useState(true);

  useEffect(() => {
    if (resetKey === undefined) return;
    row.current?.scrollTo({ left: 0, behavior: "smooth" });
  }, [resetKey]);

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

    /*
     * The children are observed too, not just the row.
     *
     * Watching only the row misses the case that matters: the row's own box
     * never changes size, so nothing fires when its *contents* grow past it and
     * the arrows stay hidden on a shelf that plainly scrolls. Observing each
     * tile catches artwork arriving and any late reflow.
     */
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);

    return () => {
      el.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [children]);

  /**
   * Scrolls to a tile edge, roughly a screenful away.
   *
   * **Aimed at a child, not at a distance.** `scrollBy` of an arbitrary number
   * of pixels has to cooperate with `scroll-snap-type`, and the two disagree:
   * the browser applies the delta, then snapping drags the row to the nearest
   * tile start — which for a small delta is the tile it began on, so the row
   * visibly returns to where it was and the arrow looks dead.
   *
   * Picking a real child and scrolling to *its* offset lands exactly where
   * snapping already wants to be, so there is nothing to fight. It also aligns
   * the row to a card rather than cutting one down the middle.
   */
  function nudge(direction: 1 | -1) {
    const el = row.current;
    if (!el) return;

    const tiles = [...el.children] as HTMLElement[];
    if (tiles.length === 0) return;

    // How far to travel before choosing a tile: most of a screenful, so the
    // press moves a page rather than a single card.
    const target = el.scrollLeft + direction * el.clientWidth * 0.8;

    // The tile whose start is nearest that point, measured against the row's
    // own scroll origin rather than the page.
    const origin = tiles[0]!.offsetLeft;
    let best = tiles[0]!;
    for (const tile of tiles) {
      if (Math.abs(tile.offsetLeft - origin - target) < Math.abs(best.offsetLeft - origin - target)) {
        best = tile;
      }
    }

    el.scrollTo({ left: best.offsetLeft - origin, behavior: "smooth" });
  }

  return (
    <section className="mb-6 sm:mb-9">
      <div className="mb-2.5 flex items-center justify-between gap-4 px-1 sm:mb-3.5">
        <h2 className="text-lg font-extrabold tracking-tight sm:text-xl">{title}</h2>

        <div className="flex shrink-0 items-center gap-2">
          {caption && (
            <p className="slab-sm hidden rounded-[var(--r-full)] bg-[var(--surface-2)] px-2.5 py-1 text-[11px] font-semibold text-[var(--fg-dim)] @md:block">
              {caption}
            </p>
          )}
          {/*
            Always drawn, each disabled at its end.

            They used to appear only once a script had measured the row as
            overflowing, which meant they were absent from the server's markup,
            absent for a moment after every load, and absent entirely whenever
            the measurement was taken before the artwork settled. A row of cards
            that plainly scrolls and offers no visible way to scroll it reads as
            broken — and a pair of arrows greyed out on the rare row that fits
            is a far smaller cost than a pair nobody can find.
          */}
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
        </div>
      </div>

      {/*
        `ref={row}` is the whole component.

        It was missing, and everything downstream failed silently because of it:
        `row.current` was always null, so `nudge()` returned on its first line
        and the measuring effect returned before attaching a listener. The
        arrows rendered, looked live, and did nothing — and no error was ever
        raised, because every use of the ref was written to fail quietly.

        `scroll-pl-1` matches `px-1`: without it the browser snaps the first tile
        to the raw scroll origin inside the padding, and the row starts silently
        offset by exactly the padding width.
      */}
      <div
        ref={row}
        className="shelf flex snap-x snap-proximity gap-3 overflow-x-auto scroll-pl-1 px-1 pb-1 sm:gap-4"
      >
        {children}
      </div>
    </section>
  );
}
