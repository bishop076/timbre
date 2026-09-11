import { TILE } from "./song-card";

export function TileSkeletons() {
  return Array.from({ length: 8 }, (_, index) => (
    <div key={index} className={TILE} aria-hidden>
      <div className="pointer-events-none">
        <div className="aspect-square animate-pulse rounded-[var(--r-lg)] bg-[var(--surface-2)]" />
        <div className="mt-2.5 px-0.5 pb-0.5 sm:mt-3">
          <div className="h-[18px] py-[3px] sm:h-5">
            <div className="h-full w-3/4 animate-pulse rounded bg-[var(--surface-2)]" />
          </div>
          <div className="mt-0.5 h-4 py-[3px]">
            <div className="h-full w-1/2 animate-pulse rounded bg-[var(--surface-2)]" />
          </div>
        </div>
      </div>
    </div>
  ));
}
