import { EYEBROW, Page } from "@/app/page-chrome";
import { RowSkeletons } from "@/app/row-skeleton";

const BAR = "animate-pulse rounded-[var(--r-sm)] bg-[var(--surface-2)]";

/**
 * Why this is not `DetailSkeleton`: that one draws a square sleeve, and an artist is a face —
 * `ARTIST_ART` in `artist-view.tsx` is the only detail header that is round. Everything else
 * here is copied from that file so the two agree: `DetailHeader`'s margins and gaps, the
 * clamped title's `1.75rem/@lg:2.25rem/@3xl:2.5rem`, `SectionRow`'s heading.
 *
 * The rows are `RowSkeletons` at `sm`, the size `artist-view.tsx` draws its tracks at, which is
 * also what the live page itself shows while its song request
 * is in flight — so this file hands over to that one without a flicker. This covers the earlier
 * wait nobody sees: the server looking the artist up and fetching a discography, during which
 * the route rendered nothing at all.
 *
 * No "use client": a loading file should not ship a bundle.
 */
export default function ArtistLoading() {
  return (
    <Page>
      <div role="status" aria-busy="true">
        <span className="sr-only">Loading artist</span>

        <header className="mb-4 flex flex-col gap-4 @lg:mb-6 @lg:flex-row @lg:items-end @lg:gap-6">
          <div className="size-28 shrink-0 animate-pulse rounded-[var(--r-full)] bg-[var(--surface-2)] @lg:size-40" />

          <div className="min-w-0 flex-1">
            <p className={EYEBROW} aria-hidden>
              Artist
            </p>
            <div className={`mt-1 h-[30px] w-2/3 @lg:h-[38px] @3xl:h-[42px] ${BAR}`} />
            <div className={`mt-1.5 h-3.5 w-2/5 ${BAR}`} />
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <div className={`h-10 w-28 rounded-[var(--r-full)] ${BAR}`} />
              <div className={`h-10 w-40 rounded-[var(--r-full)] ${BAR}`} />
            </div>
          </div>
        </header>

        <section className="mb-7 sm:mb-9">
          <div className="mb-3 px-1">
            <div className={`h-6 w-28 ${BAR}`} />
          </div>
          <RowSkeletons size="sm" />
        </section>
      </div>
    </Page>
  );
}
