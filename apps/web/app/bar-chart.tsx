"use client";

export function BarChart({
  rows,
  unit,
  onPick,
}: {
  rows: { key: string; label: string; value: number; note?: string }[];
  unit: string;
  onPick?: (key: string) => void;
}) {
  const max = Math.max(...rows.map((row) => row.value), 1);

  return (
    <ul className="flex flex-col gap-[2px]">
      {rows.map((row) => {
        const body = (
          <>
            <span className="w-24 shrink-0 truncate text-[12px] font-medium @sm:w-36 @2xl:w-48 @2xl:text-[13px]">
              {row.label}
            </span>

            <span className="relative h-4 min-w-0 flex-1 overflow-hidden rounded-[3px] bg-[var(--surface-2)]">
              <span
                className="absolute inset-y-0 left-0 rounded-r-[4px] bg-[var(--accent)]"
                style={{ width: `${(row.value / max) * 100}%` }}
              />
            </span>

            <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-[var(--fg-dim)] @sm:w-16 @sm:text-[12px]">
              {row.value}
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
