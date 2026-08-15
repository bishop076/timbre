/**
 * The placeholder for a cover tile — a square, a title bar and a shorter subtitle bar,
 * because that is what a `SongCard` is. Reserving the same box is the point: a skeleton
 * of a different height moves the page when the real content lands.
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

/** A row of them, each in a box of the caller's width. `aria-hidden` on every tile: a
 * screen reader announcing eight empty groups is worse than silence. */
export function TileSkeletons({ count, className }: { count: number; className?: string }) {
  return Array.from({ length: count }, (_, index) => (
    <div key={index} className={className} aria-hidden>
      <TileSkeleton />
    </div>
  ));
}
