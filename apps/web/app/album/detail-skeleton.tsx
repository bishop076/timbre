/**
 * The shape a detail page will be, drawn before it is.
 *
 * Deliberately not "a spinner in the middle of the page": the header block and the rows are laid
 * out at the sizes the real thing uses, so when the data lands the only thing that changes is
 * what is written in the boxes. A pixel wrong here shows up as the page lurching, which is the
 * exact failure this exists to prevent — so the heights are not guessed. Every placeholder that
 * stands in for text is a `1lh` box carrying that text's own font-size and leading classes, and
 * `1lh` is one line box of exactly that type. Change the header's type and this follows it.
 *
 * The one number not derived from type is the row padding, which belongs to `SCALE.sm` in
 * song-row.tsx: `py-2 sm:py-2.5` and a `size-10 sm:size-11` thumbnail. Change those and change
 * these, or the list will step down by a few pixels as it loads.
 *
 * No "use client": these are static boxes, and a `loading.tsx` should not ship a bundle.
 */
export function DetailSkeleton({
  rows = 8,
  lines = 1,
  thumb = false,
  album = false,
  note = 0,
}: {
  /** How many track rows to draw. Enough to reach the bottom of a 690px window. */
  rows?: number;
  /** 1 when the list's rows are a title alone, 2 when there is an artist under it. */
  lines?: 1 | 2;
  /** Whether the real rows carry artwork, which sets their height when it is there. */
  thumb?: boolean;
  /** Whether the real list carries an Album column, so the column head matches. */
  album?: boolean;
  /** How many lines of note paragraph the real header reserves under its buttons. */
  note?: 0 | 2 | 3;
}) {
  const bar = "animate-pulse rounded-[var(--r-sm)] bg-[var(--surface-2)]";

  return (
    <div
      aria-hidden
      className="@container mx-auto w-full max-w-6xl px-4 pb-16 pt-4 sm:px-7 sm:pb-20 sm:pt-6"
    >
      <header className="mb-4 flex flex-col gap-4 @lg:mb-6 @lg:flex-row @lg:items-end @lg:gap-6">
        <div className="size-28 shrink-0 animate-pulse rounded-[var(--r-lg)] bg-[var(--surface-2)] @lg:size-40" />
        <div className="min-w-0 flex-1">
          <div className="h-[1lh] text-[11px]">
            <div className={`h-2.5 w-20 ${bar}`} />
          </div>
          <div className="mt-1 h-[1lh] text-[1.75rem] leading-[1.06] @lg:text-[2.25rem] @3xl:text-[2.5rem]">
            <div className={`h-[62%] w-2/3 ${bar}`} />
          </div>
          <div className="mt-1.5 h-[1lh] text-[13px]">
            <div className={`h-3 w-2/5 ${bar}`} />
          </div>
          <div className="mt-4 flex items-center gap-2">
            <div className={`h-10 w-28 rounded-[var(--r-full)] ${bar}`} />
            <div className={`size-10 rounded-[var(--r-full)] ${bar}`} />
            <div className={`h-10 w-40 rounded-[var(--r-full)] ${bar}`} />
          </div>
          {note > 0 && (
            <div className="mt-2.5 max-w-prose text-[11px] leading-relaxed">
              {["100%", "96%", "62%"].slice(0, note).map((width) => (
                <div key={width} className="flex h-[1lh] items-center">
                  <div className={`h-2 ${bar}`} style={{ width }} />
                </div>
              ))}
            </div>
          )}
        </div>
      </header>

      <div className="mb-1 hidden items-center gap-2.5 border-b-[length:var(--edge)] border-[var(--line)] px-2 pb-1.5 sm:gap-3 @md:flex">
        <div className={`h-2.5 w-3 ${bar}`} />
        <div className="min-w-0 flex-1" />
        {album && <div className={`hidden h-2.5 w-10 @2xl:block ${bar}`} />}
        <div className={`h-2.5 w-8 ${bar}`} />
      </div>

      <ul className="divide-y divide-[var(--line)]">
        {Array.from({ length: rows }, (_, index) => (
          <li key={index} className="flex items-center gap-2.5 px-2 sm:gap-3">
            <div className={`h-3 w-6 shrink-0 ${bar}`} />
            <div className="flex min-w-0 flex-1 items-center gap-2.5 py-2 sm:gap-3 sm:py-2.5">
              {thumb && (
                <div className={`size-10 shrink-0 rounded-md sm:size-11 ${bar}`} />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex h-[1lh] items-center text-[14px]">
                  <div
                    className={`h-[70%] ${bar}`}
                    style={{ width: `${44 - ((index * 7) % 18)}%` }}
                  />
                </div>
                {lines === 2 && (
                  <div className="flex h-[1lh] items-center text-[12px]">
                    <div
                      className={`h-[64%] ${bar}`}
                      style={{ width: `${26 - ((index * 5) % 11)}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
