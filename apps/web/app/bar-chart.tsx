"use client";

/**
 * A ranked bar chart.
 *
 * Horizontal, because the categories are names — an artist's name set sideways
 * under a column is either rotated or truncated, and both are worse than using
 * the axis that has room for text.
 *
 * **Bars start at zero and are never truncated.** A bar's length *is* the
 * value, so a shortened axis makes four look like double two. Where a scale
 * cannot start at zero, the form has to change — that is why the popularity
 * plot next door is dots rather than bars.
 *
 * One hue for every bar, not a ramp. Colouring darker-where-bigger would
 * re-encode the length as brightness, spending the only free channel on
 * information the chart already shows.
 */
export function BarChart({
  rows,
  unit,
  onPick,
}: {
  rows: { key: string; label: string; value: number; note?: string }[];
  /** What one unit is, for the value labels. Singular. */
  unit: string;
  onPick?: (key: string) => void;
}) {
  if (rows.length === 0) return null;

  const max = Math.max(...rows.map((row) => row.value), 1);

  return (
    <ul className="flex flex-col gap-[2px]">
      {rows.map((row) => {
        const share = (row.value / max) * 100;
        const body = (
          <>
            {/*
              Sized against the *container*, not the window.

              At a flat `w-36` this took 144px of a 328px phone row, leaving the
              bar itself under 100px — the label was winning an argument with
              the data. And `sm:w-48` was worse than useless here: it keys off
              the viewport, so on a 1280px screen where the rail and the
              now-playing panel leave a 660px column, it widened the label
              exactly when there was least room for it.
            */}
            <span className="w-24 shrink-0 truncate text-[12px] font-medium @sm:w-36 @2xl:w-48 @2xl:text-[13px]">
              {row.label}
            </span>

            {/* The track is a surface, not a second series: it says how far the
                bar could go, which is what makes a short bar readable as small
                rather than as missing. */}
            <span className="relative h-4 min-w-0 flex-1 overflow-hidden rounded-[3px] bg-[var(--surface-2)]">
              <span
                className="absolute inset-y-0 left-0 rounded-r-[4px] bg-[var(--accent)]"
                style={{ width: `${share}%` }}
              />
            </span>

            <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-[var(--fg-dim)] @sm:w-16 @sm:text-[12px]">
              {row.value}
              {/* The unit is dropped on a narrow column: "9" beside a bar whose
                  heading already says what it counts is not ambiguous, and
                  "places" doubles the width of every value. */}
              <span className="hidden text-[var(--fg-faint)] @sm:inline">
                {" "}
                {row.value === 1 ? unit : `${unit}s`}
              </span>
            </span>
          </>
        );

        return (
          <li key={row.key}>
            {onPick ? (
              <button
                type="button"
                onClick={() => onPick(row.key)}
                title={row.note}
                className="flex w-full items-center gap-3 rounded-[var(--r-sm)] px-1 py-1 text-left transition hover:bg-[var(--surface-2)]"
              >
                {body}
              </button>
            ) : (
              <div className="flex w-full items-center gap-3 px-1 py-1" title={row.note}>
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
