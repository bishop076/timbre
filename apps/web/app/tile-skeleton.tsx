/**
 * The placeholder for a cover tile — the card's frame around a square, a title bar and a
 * shorter subtitle bar, because that is what a `SongCard` is. Reserving the same box is the
 * point: a skeleton of a different height moves the page when the real content lands. The
 * bars sit where the text does, at the text's line heights.
 */
export function TileSkeleton() {
  return (
    <div className="tile-card pointer-events-none p-2 sm:p-3">
      <div className="aspect-square animate-pulse rounded-[var(--r-sm)] bg-[var(--surface-2)]" />
      <div className="mt-2.5 px-0.5 pb-0.5 sm:mt-3">
        <div className="h-[18px] py-[3px] sm:h-5">
          <div className="h-full w-3/4 animate-pulse rounded bg-[var(--surface-2)]" />
        </div>
        <div className="mt-0.5 h-4 py-[3px]">
          <div className="h-full w-1/2 animate-pulse rounded bg-[var(--surface-2)]" />
        </div>
      </div>
    </div>
  );
}

/** A row of them, each in a box of the caller's width. `aria-hidden` on every tile: a
 * screen reader announcing eight empty groups is worse than silence. */
export function TileSkeletons({ count, className }: { count: number; className?: string }) {
  return Array.from({ length: count }, (_, index) => (
    <div key={index} className={className} aria-hidden>
      <TileSkeleton />
    </div>
  ));
}
