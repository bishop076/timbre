/**
 * The shape of /explore while the server fetches it.
 *
 * Every measurement here is copied from the page it stands in for — the container padding and
 * heading from discover-view.tsx, the section margins and row padding from shelf.tsx, the tile
 * from song-card.tsx. That is the whole point of the file: when the real content arrives it
 * replaces this in place instead of shoving the page around. The previous version opened with a
 * row of pills and used percentage-width cards, neither of which /explore has, so the skeleton
 * and the page disagreed about where everything sat.
 *
 * The heading is real text rather than a grey bar. It is known before the fetch starts, and a
 * title that shimmers into the identical title is motion charging rent for nothing.
 */

/* Mirrors TILE and TILE_BOX in song-card.tsx. Those live in a "use client" module, and importing
   a plain string out of one into a server component hands back a client-reference proxy rather
   than the string — so they are repeated here rather than shared. Kept literal, and in this
   order, so a diff against song-card.tsx is obvious. */
const TILE =
  "min-w-0 shrink-0 snap-start w-[calc((100%-0.5rem)/2)] @md:w-[calc((100%-1rem)/3)] @2xl:w-[calc((100%-1.5rem)/4)] @3xl:w-[calc((100%-2rem)/5)] @5xl:w-[calc((100%-2.5rem)/6)]";
const TILE_BOX = "block rounded-[var(--r-lg)] p-2";

const BAR = "animate-pulse rounded-[var(--r-sm)] bg-[var(--surface-2)]";

/* Eight is what TileSkeletons draws, and it is two more than the six columns a 1152px container
   divides into — so the shelf always overflows, as a loaded one does. */
const TILES = [0, 1, 2, 3, 4, 5, 6, 7];

function ShelfSkeleton({ titleWidth }: { titleWidth: string }) {
  return (
    /* mb-6 @xl:mb-9 is Shelf's own section margin. */
    <section aria-hidden className="mb-6 @xl:mb-9">
      {/* SectionHeader: mb-2.5 px-1 sm:mb-3.5, and h-7 because SectionTitle is 28px of
          line-height at both text-lg and text-xl. */}
      <div className="mb-2.5 flex items-center justify-between gap-4 px-1 sm:mb-3.5">
        <div className="flex h-7 items-center">
          <div className={`h-5 ${BAR}`} style={{ width: titleWidth }} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* `slab-sm` because the real arrows carry the ink edge, and the border is inside the
              box — the circle stays 28px whatever --edge is set to. */}
          {[0, 1].map((arrow) => (
            <div
              key={arrow}
              className="slab-sm size-7 rounded-[var(--r-full)] bg-[var(--surface-2)]"
            />
          ))}
        </div>
      </div>

      {/* The loaded row is `overflow-x-auto`; this one is `overflow-hidden`, because a skeleton
          that can be scrolled sideways invites a gesture that is about to be thrown away. The
          padding matches either way, so the first tile starts in the same place. */}
      <div className="flex gap-2 overflow-hidden px-1 pb-1">
        {TILES.map((tile) => (
          <div key={tile} className={TILE}>
            <div className={TILE_BOX}>
              <div className="aspect-square animate-pulse rounded-[var(--r-md)] bg-[var(--surface-2)]" />
              <div className="mt-2">
                <div className="h-5 py-[3px]">
                  <div className={`h-full w-3/4 ${BAR}`} />
                </div>
                <div className="mt-0.5 h-4 py-[3px]">
                  <div className={`h-full w-1/2 ${BAR}`} />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function ExploreLoading() {
  return (
    <div className="@container mx-auto w-full max-w-6xl px-4 pb-16 pt-2 sm:px-7 sm:pb-20 sm:pt-4">
      <h1 className="mb-4 px-1 text-xl font-extrabold tracking-tight sm:mb-6 sm:text-2xl">
        Explore
      </h1>

      <p role="status" className="sr-only">
        Loading Explore.
      </p>

      {/* Three: what a 690px-tall window can reach before the fetch is usually done, and the
          count the page itself opens with — new releases, then two genre shelves. The widths
          vary so the placeholder titles do not read as a printed form. */}
      {["10rem", "13rem", "8.5rem"].map((width) => (
        <ShelfSkeleton key={width} titleWidth={width} />
      ))}
    </div>
  );
}
