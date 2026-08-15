/**
 * The placeholder for a cover tile.
 *
 * Written out in five places before this: twice in `search-results.tsx`, once
 * in `explore/loading.tsx`, once in `profile-view.tsx`. They had already drifted
 * — two used `rounded`, one `rounded-[var(--r-sm)]`, and the bar widths
 * disagreed — which is the usual fate of a shape that is easier to retype than
 * to import.
 *
 * A square, a title bar and a shorter subtitle bar, because that is what a
 * `SongCard` is. Reserving the same box is the whole point: a skeleton that is a
 * different height from the thing it stands in for moves the page when the real
 * content lands, which is the problem it was supposed to solve.
 */
export function TileSkeleton() {
  return (
    <>
      <div className="aspect-square animate-pulse rounded-[var(--r-lg)] bg-[var(--surface-2)]" />
      <div className="mt-2.5 h-3 w-3/4 animate-pulse rounded bg-[var(--surface-2)]" />
      <div className="mt-1.5 h-2.5 w-1/2 animate-pulse rounded bg-[var(--surface-2)]" />
    </>
  );
}

/**
 * A row of them, each in a box of the caller's width.
 *
 * `aria-hidden` on every tile: a screen reader announcing eight empty groups is
 * worse than silence while something loads.
 */
export function TileSkeletons({ count, className }: { count: number; className?: string }) {
  return Array.from({ length: count }, (_, index) => (
    <div key={index} className={className} aria-hidden>
      <TileSkeleton />
    </div>
  ));
}
