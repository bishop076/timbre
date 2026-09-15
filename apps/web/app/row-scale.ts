/**
 * The three sizes a song row comes in, as the classes that draw one.
 *
 * Lifted out of `song-row.tsx` so `row-skeleton.tsx` can reserve the space a real row will take
 * rather than guess at it. The skeleton had its own hardcoded `size-14` thumbnail and `py-3`,
 * which is 80px a row against a real 72.8px at `md` and 64px at `sm` — every song list in the
 * app jumped by half a row per row as it loaded, about 48px on search and 96px on an artist.
 * A row's height is its thumbnail plus the vertical padding on `play`, so those two are what
 * both files have to agree on, and the only way to be sure they do is to read the same map.
 */
const MEDIUM = {
  row: "gap-3 sm:gap-4",
  play: "gap-2.5 py-2 sm:gap-4 sm:py-3",
  rank: "text-[length:var(--text-meta)]",
  thumb: "size-10 sm:size-12",
  note: "size-5",
  icon: "size-4",
  title: "text-[length:var(--text-body)]",
  subtitle: "text-[length:var(--text-meta)]",
};

export const SCALE = {
  sm: {
    row: "gap-2.5 sm:gap-3",
    play: "gap-2.5 py-2 sm:gap-3 sm:py-2.5",
    rank: "text-[length:var(--text-meta)] font-bold",
    thumb: "size-10 sm:size-11",
    note: "size-4",
    icon: "size-4",
    title: "text-[length:var(--text-meta)]",
    subtitle: "text-[12px]",
  },
  md: MEDIUM,
  lg: { ...MEDIUM, play: "gap-3 py-3 sm:gap-4", thumb: "size-12", icon: "size-5" },
};

export type RowSize = keyof typeof SCALE;
