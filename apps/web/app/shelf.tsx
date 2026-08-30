"use client";

import { useEffect, useRef, useState } from "react";

import { ChevronIcon } from "./icons";

/** A horizontal row of tiles with arrows, which are always drawn and each disable at their
 * end. The only shelf — `search-results.tsx` had a near-copy carrying both bugs below. */
export function Shelf({
  title,
  caption,
  resetKey,
  children,
}: {
  title: string;
  caption?: string;
  /** Changes when the row's *first* item changes, sending it back to the start.
   * `overflow-anchor: none` stops the browser fighting a prepend, but a row already scrolled is
   * left mid-way with the newest item behind it. Only "Recently played" passes it. */

  resetKey?: string;
  children: React.ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  // Assumed scrollable until measured: guessing otherwise left the arrows missing on paint.
  const [canRight, setCanRight] = useState(true);

  useEffect(() => {
    if (resetKey === undefined) return;
    row.current?.scrollTo({ left: 0, behavior: "smooth" });
  }, [resetKey]);

  useEffect(() => {
    const el = row.current;
    if (!el) return;

    const measure = () => {
      // A pixel of slack: sub-pixel layout means scrollLeft rarely lands on the exact maximum.
      setCanLeft(el.scrollLeft > 1);
      setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    };

    measure();
    el.addEventListener("scroll", measure, { passive: true });

    // The children too: the row's box never changes size, so nothing fires when its contents
    // grow past it and the arrows stay hidden on a shelf that plainly scrolls.
    const sizes = new ResizeObserver(measure);
    const watch = () => {
      sizes.disconnect();
      sizes.observe(el);
      for (const child of el.children) sizes.observe(child);
    };
    watch();

    // Re-subscribed when tiles are added or removed, so this effect can depend on nothing:
    // `children` is a new element on every parent render, and depending on it tore down and
    // rebuilt a listener and an observer per tile whenever anything above re-rendered.
    const tiles = new MutationObserver(watch);
    tiles.observe(el, { childList: true });

    return () => {
      el.removeEventListener("scroll", measure);
      sizes.disconnect();
      tiles.disconnect();
    };
  }, []);

  /** Scrolls to a tile edge a screenful away — aimed at a child, not a distance, because
   * `scrollBy` of an arbitrary delta fights `scroll-snap-type`: snapping drags the row back to
   * the tile it began on, so the arrow looks dead. */

  function nudge(direction: 1 | -1) {
    const el = row.current;
    if (!el) return;

    const tiles = [...el.children] as HTMLElement[];
    if (tiles.length === 0) return;

    // Most of a screenful, so the press moves a page rather than a single card.
    const target = el.scrollLeft + direction * el.clientWidth * 0.8;

    // Nearest tile start to that point, measured against the row's origin, not the page.
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
          {/* Always drawn, each disabled at its end. Appearing only once a script measured the
              row as overflowing meant absent from the server's markup, absent after every load,
              and absent entirely if artwork had not settled. */}
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

      {/* `ref={row}` is the whole component: without it `row.current` is null, `nudge()` returns
          on its first line and the effect never attaches a listener — arrows that look live, do
          nothing, and raise no error. `scroll-pl-1` matches `px-1`, or the browser snaps the
          first tile to the raw origin inside the padding. */}
      <div
        ref={row}
        /* No `snap-x snap-proximity` here: `.shelf` sets `scroll-snap-type` itself and wins
           outright, so the pair that used to sit in this list could not affect anything.
           See the rule in globals.css. */
        className="shelf flex gap-3 overflow-x-auto scroll-pl-1 px-1 pb-1 sm:gap-4"
      >
        {children}
      </div>
    </section>
  );
}
