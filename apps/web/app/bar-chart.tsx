"use client";

/**
 * A ranked bar chart whose bars are decoration.
 *
 * Every value is already written beside its bar as text, so nothing here is carried by length or
 * by colour — which is the property worth keeping. What was missing was the second line: `note`
 * ("12 different songs", "Highest placing: #3") lived only in a `title` attribute, which a
 * keyboard user never sees, a touch user cannot reach, and readers announce inconsistently. It is
 * part of the row's name now, and visible text as soon as the column is wide enough to hold it.
 *
 * The unit is in the same position. `plays` was `hidden @sm:inline`, so in a narrow panel the
 * column read "199" with nothing saying 199 of what.
 */
export function BarChart({
  rows,
  unit,
  onPick,
  /** What picking a row does, for the name a reader hears — "Go to artist". */
  pickHint,
}: {
  rows: { key: string; label: string; value: number; note?: string }[];
  unit: string;
  onPick?: (key: string) => void;
  pickHint?: string;
}) {
  const max = Math.max(...rows.map((row) => row.value), 1);

  return (
    <ul className="flex flex-col gap-[2px]">
      {rows.map((row) => {
        const counted = `${row.value} ${row.value === 1 ? unit : `${unit}s`}`;
        const described = [row.label, counted, row.note].filter(Boolean).join(", ");

        const body = (
          <>
            <span className="w-24 shrink-0 truncate text-[12px] font-medium @sm:w-36 @2xl:w-48 @2xl:text-[13px]">
              {row.label}
            </span>

            <span
              aria-hidden
              className="relative h-4 min-w-0 flex-1 overflow-hidden rounded-[3px] bg-[var(--surface-2)]"
            >
              <span
                className="absolute inset-y-0 left-0 rounded-r-[4px] bg-[var(--accent)]"
                style={{ width: `${(row.value / max) * 100}%` }}
              />
            </span>

            {row.note && (
              <>
                <span className="sr-only">{row.note}</span>
                <span
                  aria-hidden
                  className="hidden w-32 shrink-0 truncate text-right text-[11px] text-[var(--fg-faint)] @2xl:inline"
                >
                  {row.note}
                </span>
              </>
            )}

            <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-[var(--fg-dim)] @sm:w-16 @sm:text-[12px]">
              {/* The unit is written twice on purpose: the visible copy disappears in a narrow
                  column, where "199" alone says nothing, so a reader gets its own that never
                  does. Two deterministic spans rather than one `sr-only`/`not-sr-only` pair,
                  whose `position` collision is settled by whichever Tailwind emits last. */}
              <span className="sr-only">{counted}</span>
              <span aria-hidden>
                {row.value}
                <span className="hidden text-[var(--fg-faint)] @sm:inline">
                  {" "}
                  {row.value === 1 ? unit : `${unit}s`}
                </span>
              </span>
            </span>
          </>
        );

        return (
          <li key={row.key}>
            {onPick ? (
              // `aria-label` on the button replaces everything inside it, so the two spans above
              // are not announced twice here.
              <button
                type="button"
                onClick={() => onPick(row.key)}
                aria-label={pickHint ? `${described}. ${pickHint}` : described}
                className="flex w-full items-center gap-3 rounded-[var(--r-sm)] px-1 py-1 text-left transition hover:bg-[var(--surface-2)]"
              >
                {body}
              </button>
            ) : (
              <div className="flex w-full items-center gap-3 px-1 py-1">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
