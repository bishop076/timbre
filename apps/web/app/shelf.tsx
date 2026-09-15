"use client";

import { useEffect, useRef, useState } from "react";

import { moveBetweenItems } from "./a11y/arrow-nav";
import { scrollBehavior } from "./a11y/motion";
import { ChevronIcon } from "./icons";
import { SectionHeader } from "./page-chrome";

const ARROW =
  "slab-sm press flex size-7 items-center justify-center rounded-[var(--r-full)] bg-[var(--surface-2)] text-[var(--fg)] transition-opacity disabled:opacity-30";

/**
 * How far in the row dissolves at an edge that is cutting a tile in half.
 *
 * 40px: the scroller's own `px-1` and each tile's `p-2` already account for 12 of it, and at 24
 * the covers barely moved while the title underneath still ended on a hard vertical edge.
 */
const FADE = "2.5rem";

/**
 * Masked only where a tile is genuinely sliced — not merely where there is more to scroll to.
 *
 * "there is more" was the wrong test. A shelf holds a dozen tiles and shows six, so it is
 * always true, so the fade was always on: at a full-width window the app appeared to be fading
 * something for no reason. Now that `TILE` divides the track into whole columns, a shelf at rest
 * ends on a tile boundary with nothing cut, and this returns `undefined` — no mask, crisp edges,
 * everything the row is showing shown whole. The fade appears where a tile really is split
 * across the edge: mid-scroll, or while a pane is being dragged between two column counts.
 *
 * Leaving it off by default matters beyond looks, too. A mask clips, so an unmasked shelf lets
 * a focus ring on a tile near the edge survive intact.
 */
function edgeFade(left: boolean, right: boolean): string | undefined {
  if (!left && !right) return undefined;
  const start = left ? `transparent 0, #000 ${FADE}` : "#000 0";
  const end = right ? `#000 calc(100% - ${FADE}), transparent 100%` : "#000 100%";
  return `linear-gradient(to right, ${start}, ${end})`;
}

/** Ignore a sliver: the column arithmetic is a percentage division and lands fractionally. */
const SLIVER = 2;

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
  const [cutLeft, setCutLeft] = useState(false);
  const [cutRight, setCutRight] = useState(false);

  useEffect(() => {
    if (resetKey !== undefined) row.current?.scrollTo({ left: 0, behavior: scrollBehavior() });
  }, [resetKey]);

  useEffect(() => {
    const el = row.current;
    if (!el) return;

    // Read once: the scroller's own padding is what separates "the edge of the box" from "the
    // edge of the track the tiles are laid out in", and every comparison below is against the
    // latter. It cannot change without the class changing, so it does not belong in `measure`.
    const style = getComputedStyle(el);
    const padLeft = parseFloat(style.paddingLeft) || 0;
    const padRight = parseFloat(style.paddingRight) || 0;

    const measure = () => {
      setCanLeft(el.scrollLeft > 1);
      setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);

      // Tile positions in scroll coordinates, taking the first tile as the origin — so the
      // window on them is exactly [scrollLeft, scrollLeft + track]. A tile that starts before an
      // edge and ends after it is the one being cut in half, and the only reason to fade.
      const tiles = [...el.children] as HTMLElement[];
      const origin = tiles[0]?.offsetLeft ?? 0;
      const from = el.scrollLeft;
      const to = from + el.clientWidth - padLeft - padRight;
      let left = false;
      let right = false;
      for (const tile of tiles) {
        const a = tile.offsetLeft - origin;
        const b = a + tile.offsetWidth;
        if (a < from - SLIVER && b > from + SLIVER) left = true;
        if (a < to - SLIVER && b > to + SLIVER) right = true;
      }
      setCutLeft(left);
      setCutRight(right);
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

      {/* Tighter than it looks: each tile carries its own padding, so the space between two
          covers is this gap plus 2 × that padding. One number at every size, deliberately —
          `TILE` divides the track by subtracting these gaps from 100%, and a gap that changed
          at a breakpoint `TILE` did not share would put a fraction of a tile back on the end. */}
      {/* A shelf scrolls sideways, so sideways is how a keyboard should walk it. Without this
          the only way past tile three is Tab through every control on tiles one and two, and the
          arrow keys scroll the *page* instead — which is the bug worth naming: the browser's
          default for an arrow key is to move the viewport, and a list that moves focus without
          also taking the key leaves you looking somewhere else entirely. `moveBetweenItems`
          does both or neither. */}
      <div
        ref={row}
        onKeyDown={(event) => moveBetweenItems(event, row.current, "horizontal")}
        style={{ maskImage: edgeFade(cutLeft, cutRight) }}
        className="shelf flex gap-2 overflow-x-auto scroll-pl-1 px-1 pb-1"
      >
        {children}
      </div>
    </section>
  );
}
