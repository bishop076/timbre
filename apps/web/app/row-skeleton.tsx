import { SCALE, type RowSize } from "./row-scale.ts";

/**
 * The space a list of song rows is about to need, drawn at the size the rows will actually be.
 *
 * It used to reserve one height for every caller — a `size-14` thumbnail inside `py-3`, so 80px
 * a row — while search draws `md` rows (72.8px) and an artist's tracks draw `sm` ones (64px).
 * Six rows of that is 48px of slack on search and 96px on an artist, taken back the moment the
 * songs arrive: the list under it jumps up as the placeholder is replaced, which is the exact
 * shift a skeleton exists to prevent. The thumbnail and the padding are read from the same
 * `SCALE` the real row uses, so the two cannot drift apart again.
 */
export function RowSkeletons({ size = "md", rows = 6 }: { size?: RowSize; rows?: number }) {
  const scale = SCALE[size];

  return (
    <ul className="divide-y divide-[var(--line)]" aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className={`flex items-center px-2 ${scale.row}`}>
          <div className={`flex min-w-0 flex-1 items-center ${scale.play}`}>
            <div
              className={`shrink-0 animate-pulse rounded-[var(--r-sm)] bg-[var(--surface-2)] ${scale.thumb}`}
            />
            <div className="min-w-0 flex-1 space-y-2">
              <div
                className="h-4 animate-pulse rounded bg-[var(--surface-2)]"
                style={{ width: `${55 - index * 4}%` }}
              />
              <div
                className="h-3 animate-pulse rounded bg-[var(--surface-2)]"
                style={{ width: `${35 - index * 2}%` }}
              />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
