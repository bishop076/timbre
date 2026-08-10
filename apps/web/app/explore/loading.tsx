/**
 * What Explore looks like before Deezer has answered.
 *
 * **This page has an unavoidable waterfall on its critical path.** `fetchDiscover`
 * asks for the chart, and only then can it ask for the featured playlists' own
 * sleeves — those requests need ids that the first response carries, so they
 * cannot be started alongside it. Two round trips to Deezer, about 1.2s cold, and
 * until now every one of them happened *before any HTML existed*: a navigation to
 * Explore did nothing at all for over a second and then the whole page appeared at
 * once. The arrival animation had nothing to soften, because the wait was in front
 * of it rather than inside it.
 *
 * A loading boundary moves the wait behind the shell. Next sends this immediately
 * — the sidebar, the ground, the header — and streams the real content in when it
 * lands, so the navigation is instant and `.page-in` plays on something that is
 * already on screen.
 *
 * **The cost is honest: this does not make Explore faster, it makes it start.** In
 * production the page is `revalidate = 3600`, so the first visitor of the hour pays
 * the 1.2s and everyone else is served from the cache in milliseconds. This is for
 * that first visitor, for a cold cache after a deploy, and for development — where
 * every edit invalidates and so every load is the slow one.
 *
 * Shaped like the page rather than like a spinner. The pill row and the shelves
 * are where the content lands, so the layout does not jump when it arrives, and
 * nothing here claims to be measuring progress it cannot see.
 */
export default function ExploreLoading() {
  return (
    <div className="@container mx-auto w-full max-w-6xl px-4 pb-16 pt-3 sm:px-7 sm:pb-20">
      {/* The genre pills. */}
      <div className="shelf flex gap-2 overflow-x-hidden">
        {[0, 1, 2, 3, 4, 5, 6].map((pill) => (
          <div
            key={pill}
            className="h-8 shrink-0 animate-pulse rounded-[var(--r-full)] bg-[var(--surface-2)]"
            // Uneven widths, because a row of identical rectangles reads as a
            // grid rather than as words waiting to be words.
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
