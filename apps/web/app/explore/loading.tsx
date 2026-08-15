/**
 * What Explore looks like before Deezer has answered. `fetchDiscover` has an unavoidable
 * waterfall — the featured playlists' sleeves need ids the chart response carries — and all
 * 1.2s of it used to happen before any HTML existed, so the navigation did nothing and then
 * the whole page appeared with `.page-in` having nothing to soften.
 */
export default function ExploreLoading() {
  return (
    <div className="@container mx-auto w-full max-w-6xl px-4 pb-16 pt-3 sm:px-7 sm:pb-20">
      <div className="shelf flex gap-2 overflow-x-hidden">
        {[0, 1, 2, 3, 4, 5, 6].map((pill) => (
          <div
            key={pill}
            className="h-8 shrink-0 animate-pulse rounded-[var(--r-full)] bg-[var(--surface-2)]"
            // Uneven widths — identical rectangles read as a grid, not as words.
            style={{ width: `${[72, 58, 84, 64, 92, 56, 78][pill]}px` }}
          />
        ))}
      </div>

      {[0, 1].map((shelf) => (
        <div key={shelf} className="mt-8">
          <div className="h-5 w-40 animate-pulse rounded-[var(--r-md)] bg-[var(--surface-2)]" />
          <div className="shelf mt-4 flex gap-4 overflow-x-hidden">
            {[0, 1, 2, 3, 4, 5].map((card) => (
              <div key={card} className="w-[46%] shrink-0 @md:w-[30%] @2xl:w-[22%] @4xl:w-[18%]">
                <div className="aspect-square w-full animate-pulse rounded-[var(--r-lg)] bg-[var(--surface-2)]" />
                <div className="mt-2.5 h-3.5 w-4/5 animate-pulse rounded-[var(--r-sm)] bg-[var(--surface-2)]" />
                <div className="mt-1.5 h-3 w-2/5 animate-pulse rounded-[var(--r-sm)] bg-[var(--surface-2)]" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
