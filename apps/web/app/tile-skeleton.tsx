import { TILE, TILE_BOX } from "./song-card";

export function TileSkeletons() {
  return Array.from({ length: 8 }, (_, index) => (
    <div key={index} className={TILE} aria-hidden>
      <div className={`pointer-events-none ${TILE_BOX} hover:bg-transparent`}>
        {/* Flat and neutral on purpose: a skeleton says "not here yet", where `COVER_EMPTY`
            says "there is no picture for this". Pulsing the placeholder's gradient made a row
            of soft blurred blobs that read as out of focus rather than as loading. */}
        <div className="aspect-square animate-pulse rounded-[var(--r-md)] bg-[var(--surface-2)]" />
        <div className="mt-2">
          <div className="h-5 py-[3px]">
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
