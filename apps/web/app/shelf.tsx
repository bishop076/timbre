"use client";

import { useEffect, useRef, useState } from "react";

import { moveBetweenItems } from "./a11y/arrow-nav";
import { scrollBehavior } from "./a11y/motion";
import { ChevronIcon } from "./icons";
import { SectionHeader } from "./page-chrome";

const ARROW =
  "slab-sm press flex size-7 items-center justify-center rounded-[var(--r-full)] bg-[var(--surface-2)] text-[var(--fg)] transition-opacity disabled:opacity-30";

/**
 * How far in the row dissolves at an edge it can still scroll past.
 *
 * The only thing that told you a shelf continues was the half tile sitting at the right margin,
 * and a half tile ending in a hard vertical cut reads as a card that got clipped, not as a row
 * that goes on — same picture as a broken layout. Dissolving the end of it turns the identical
 * half tile into a deliberate "there is more". 40px because the scroller's own `px-1` and each
 * tile's `p-2` already account for 12 of it: at 24 the covers barely moved and the title
 * underneath still ended on a hard vertical edge, which was the tell.
 */
const FADE = "2.5rem";

/**
 * Only masked on a side that has somewhere to go — tied to the same state the arrows are, so a
 * shelf that fits its row is drawn with crisp edges and no mask at all. That matters beyond
 * looks: a mask clips, and an unmasked shelf lets a focus ring near the edge survive intact.
 */
function edgeFade(left: boolean, right: boolean): string | undefined {
  if (!left && !right) return undefined;
  const start = left ? `transparent 0, #000 ${FADE}` : "#000 0";
  const end = right ? `#000 calc(100% - ${FADE}), transparent 100%` : "#000 100%";
  return `linear-gradient(to right, ${start}, ${end})`;
}

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
    if (resetKey !== undefined) row.current?.scrollTo({ left: 0, behavior: scrollBehavior() });
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
    el.scrollTo({ left: best.offsetLeft - origin, behavior: scrollBehavior() });
  }

  return (
    <section aria-label={title} className="mb-6 @xl:mb-9">
      <SectionHeader title={title}>
        {caption && (
          <p className="slab-sm hidden rounded-[var(--r-full)] bg-[var(--surface-2)] px-2.5 py-1 text-[11px] font-semibold text-[var(--fg-dim)] @md:block">
            {caption}
          </p>
        )}
        <div className="flex items-center gap-1">
          {([-1, 1] as const).map((direction) => (
            <button
              key={direction}
              type="button"
              onClick={() => nudge(direction)}
              disabled={direction < 0 ? !canLeft : !canRight}
              aria-label={`Scroll ${title} ${direction < 0 ? "left" : "right"}`}
              className={ARROW}
            >
              <ChevronIcon className={`size-4 ${direction < 0 ? "rotate-90" : "-rotate-90"}`} />
            </button>
          ))}
        </div>
      </SectionHeader>

      {/* Tighter than it looks: each tile now carries its own padding, so the space between
          two covers is this gap plus 2 × that padding — the same air as before. */}
      {/* A shelf scrolls sideways, so sideways is how a keyboard should walk it. Without this
          the only way past tile three is Tab through every control on tiles one and two, and the
          arrow keys scroll the *page* instead — which is the bug worth naming: the browser's
          default for an arrow key is to move the viewport, and a list that moves focus without
          also taking the key leaves you looking somewhere else entirely. `moveBetweenItems`
          does both or neither. */}
      <div
        ref={row}
        onKeyDown={(event) => moveBetweenItems(event, row.current, "horizontal")}
        style={{ maskImage: edgeFade(canLeft, canRight) }}
        className="shelf flex gap-1 overflow-x-auto scroll-pl-1 px-1 pb-1 @xl:gap-2"
      >
        {children}
      </div>
    </section>
  );
}
