"use client";

import { useEffect, useRef, useState } from "react";

import { ChevronIcon } from "./icons";
import { SectionHeader } from "./page-chrome";

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
    if (resetKey !== undefined) row.current?.scrollTo({ left: 0, behavior: "smooth" });
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
    if (!el?.firstElementChild) return;

    const tiles = [...el.children] as HTMLElement[];
    const origin = tiles[0]!.offsetLeft;
    const target = el.scrollLeft + direction * el.clientWidth * 0.8;
    const distance = (tile: HTMLElement) => Math.abs(tile.offsetLeft - origin - target);
    const best = tiles.reduce((closest, tile) =>
      distance(tile) < distance(closest) ? tile : closest,
    );
    el.scrollTo({ left: best.offsetLeft - origin, behavior: "smooth" });
  }

  return (
    <section className="mb-6 sm:mb-9">
      <SectionHeader title={title}>
        {caption && (
          <p className="slab-sm hidden rounded-[var(--r-full)] bg-[var(--surface-2)] px-2.5 py-1 text-[11px] font-semibold text-[var(--fg-dim)] @md:block">
            {caption}
          </p>
        )}
      </SectionHeader>

      <div className="relative">
        {([-1, 1] as const).map((direction) => (
          <button
            key={direction}
            type="button"
            onClick={() => nudge(direction)}
            disabled={direction < 0 ? !canLeft : !canRight}
            aria-label={`Scroll ${title} ${direction < 0 ? "left" : "right"}`}
            className={`${ARROW} ${direction < 0 ? "left-2" : "right-2"}`}
          >
            <ChevronIcon className={`size-5 ${direction < 0 ? "rotate-90" : "-rotate-90"}`} />
          </button>
        ))}

        <div ref={row} className="shelf flex gap-3 overflow-x-auto scroll-pl-1 px-1 pb-1 sm:gap-4">
          {children}
        </div>
      </div>
    </section>
  );
}
