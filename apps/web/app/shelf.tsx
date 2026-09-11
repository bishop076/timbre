"use client";

import { useEffect, useRef, useState } from "react";

import { ChevronIcon } from "./icons";

const ARROW =
  "slab-sm press absolute top-1/2 z-10 hidden size-9 -translate-y-1/2 items-center justify-center rounded-[var(--r-full)] bg-[var(--surface-2)] text-[var(--fg)] pointer-fine:flex disabled:invisible";

export function Shelf({
  title,
  caption,
  resetKey,
  children,
}: {
  title: string;
  caption?: string;

  resetKey?: string;
  children: React.ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(true);

  useEffect(() => {
    if (resetKey === undefined) return;
    row.current?.scrollTo({ left: 0, behavior: "smooth" });
  }, [resetKey]);

  useEffect(() => {
    const el = row.current;
    if (!el) return;

    const measure = () => {
      setCanLeft(el.scrollLeft > 1);
      setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    };

    measure();
    el.addEventListener("scroll", measure, { passive: true });

    const sizes = new ResizeObserver(measure);
    const watch = () => {
      sizes.disconnect();
      sizes.observe(el);
      for (const child of el.children) sizes.observe(child);
    };
    watch();

    const tiles = new MutationObserver(watch);
    tiles.observe(el, { childList: true });

    return () => {
      el.removeEventListener("scroll", measure);
      sizes.disconnect();
      tiles.disconnect();
    };
  }, []);

  function nudge(direction: 1 | -1) {
    const el = row.current;
    if (!el) return;

    const tiles = [...el.children] as HTMLElement[];
    if (tiles.length === 0) return;

    const target = el.scrollLeft + direction * el.clientWidth * 0.8;

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

        {caption && (
          <p className="slab-sm hidden shrink-0 rounded-[var(--r-full)] bg-[var(--surface-2)] px-2.5 py-1 text-[11px] font-semibold text-[var(--fg-dim)] @md:block">
            {caption}
          </p>
        )}
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => nudge(-1)}
          disabled={!canLeft}
          aria-label={`Scroll ${title} left`}
          className={`${ARROW} left-2`}
        >
          <ChevronIcon className="size-5 rotate-90" />
        </button>
        <button
          type="button"
          onClick={() => nudge(1)}
          disabled={!canRight}
          aria-label={`Scroll ${title} right`}
          className={`${ARROW} right-2`}
        >
          <ChevronIcon className="size-5 -rotate-90" />
        </button>

        <div
          ref={row}
          className="shelf flex gap-3 overflow-x-auto scroll-pl-1 px-1 pb-1 sm:gap-4"
        >
          {children}
        </div>
      </div>
    </section>
  );
}
