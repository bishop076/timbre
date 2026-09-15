const STEPS = [
  "var(--accent)",
  "color-mix(in oklab, var(--accent) 78%, var(--surface-2))",
  "color-mix(in oklab, var(--accent) 55%, var(--surface-2))",
  "color-mix(in oklab, var(--accent) 32%, var(--surface-2))",
];

const PLOT_H = 150;
const AXIS_W = 28;

/** Past this many columns the labels stop fitting and the gaps have to give way first. */
const CROWDED = 14;

export interface Column {
  /**
   * React key and table row key. Defaults to `label` — which stopped being unique the moment a
   * chart wanted thirty columns, most of whose axis labels are deliberately blank.
   */
  key?: string;
  /** The whole name. Used by the tooltip, the reader and the table. */
  label: string;
  /** What is printed under the column. Defaults to `label`; `""` leaves the slot empty. */
  axis?: string;
  total: number;
  values: number[];
}

const plural = (value: number, unit: string) => (value === 1 ? unit : `${unit}s`);

/**
 * A column chart with a text equivalent, not a column chart with a tooltip.
 *
 * Every number here used to exist in exactly one place: a tooltip that appears on hover or focus.
 * The axis was `aria-hidden`, the tooltip is hidden with `visibility` so it is out of the
 * accessibility tree until it opens, and the columns were bare `tabIndex={0}` divs with no role
 * and no name — so a reader found seven focus stops that announced nothing and left with no
 * values at all. The chart was, to that listener, not there.
 *
 * Two changes fix it and one of them helps everybody. Each column is a named `role="img"`, so
 * focusing it says "Sunday 14 Sept, 118 plays"; and the same figures are written out underneath
 * as a real table, in a `<details>` anyone can open. The table is not an accessibility
 * afterthought parked in `sr-only` — it is where you go when you want to read the number rather
 * than estimate it, which is a thing sighted people want too.
 *
 * Nothing here is carried by colour. The bands are shades of one accent, so the legend, the
 * tooltip and the table all name each band in text beside its figure.
 */
export function StackedColumns({
  columns,
  segments,
  unit,
  caption,
  rowLabel = "Group",
}: {
  columns: Column[];
  segments: readonly string[];
  unit: string;
  /** Names the table for a reader that lands on it out of context. */
  caption?: string;
  /** The heading over the first table column — "Day", "Genre", "Week". */
  rowLabel?: string;
}) {
  const max = Math.max(...columns.map((column) => column.total), 1);
  const step = max <= 5 ? 1 : max <= 12 ? 2 : max <= 30 ? 5 : 10;
  const ceiling = Math.ceil((max * 1.1) / step) * step;
  const ticks = Array.from({ length: ceiling / step + 1 }, (_, index) => index * step);
  const banded = segments.length > 1;
  const gap = columns.length > CROWDED ? "gap-px" : "gap-1.5 sm:gap-2";

  function describe(column: Column): string {
    const head = `${column.label}: ${column.total} ${plural(column.total, unit)}`;
    if (!banded || column.total === 0) return head;

    const parts = column.values.flatMap((value, band) =>
      value === 0 ? [] : [`${segments[band] ?? `Band ${band + 1}`} ${value}`],
    );
    return `${head}. ${parts.join(", ")}`;
  }

  return (
    <div>
      <div className="pt-2">
        <div className="w-full">
          <div className="flex" style={{ height: PLOT_H }}>
            <div
              className="relative shrink-0 text-right text-[10px] tabular-nums text-[var(--fg-faint)]"
              style={{ width: AXIS_W }}
              aria-hidden
            >
              {ticks.map((tick) => (
                <span
                  key={tick}
                  className="absolute right-1.5 translate-y-1/2 leading-none"
                  style={{ bottom: `${(tick / ceiling) * 100}%` }}
                >
                  {tick}
                </span>
              ))}
            </div>

            <div className="relative min-w-0 flex-1">
              {ticks.map((tick) => (
                <div
                  key={tick}
                  aria-hidden
                  className="absolute inset-x-0 border-t border-[var(--line)]"
                  style={{ bottom: `${(tick / ceiling) * 100}%` }}
                />
              ))}

              <div className={`flex h-full items-end ${gap}`}>
                {columns.map((column, index) => (
                  <div
                    key={column.key ?? column.label}
                    tabIndex={0}
                    role="img"
                    aria-label={describe(column)}
                    className="group relative flex h-full min-w-0 flex-1 flex-col justify-end rounded-[2px] outline-none"
                  >
                    {column.values
                      .map((value, band) => ({ value, band }))
                      .reverse()
                      .map(({ value, band }) =>
                        value === 0 ? null : (
                          <div
                            key={band}
                            className="w-full first:rounded-t-[4px]"
                            style={{
                              // A floor, so one play is not a hairline a reader has to trust is
                              // there. At a 35-play ceiling the arithmetic gives a single play
                              // about two pixels, which next to an empty column is a guess.
                              height: `max(3px, calc(${(value / ceiling) * 100}% - 2px))`,
                              marginBottom: 2,
                              background: STEPS[band],
                            }}
                          />
                        ),
                      )}

                    <div
                      aria-hidden
                      className={`pointer-events-none invisible absolute bottom-full z-20 mb-1 w-40 max-w-[60vw] rounded-[var(--r-md)] bg-[var(--surface-2)] px-2.5 py-2 opacity-0 shadow-[var(--drop-lg)] transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 ${
                        index === 0
                          ? "left-0"
                          : index === columns.length - 1
                            ? "right-0"
                            : "left-1/2 -translate-x-1/2"
                      }`}
                    >
                      <p className="truncate text-[length:var(--text-meta)] font-semibold">
                        {column.label}
                      </p>
                      <p className="text-[11px] tabular-nums text-[var(--fg-dim)]">
                        {column.total} {plural(column.total, unit)}
                      </p>
                      {banded && (
                        <ul className="mt-1 space-y-0.5">
                          {column.values.map((value, band) =>
                            value === 0 ? null : (
                              <li
                                key={band}
                                className="flex items-center gap-1.5 text-[10px] text-[var(--fg-faint)]"
                              >
                                <span
                                  className="size-2 shrink-0 rounded-[2px]"
                                  style={{ background: STEPS[band] }}
                                />
                                {segments[band]}
                                <span className="ml-auto tabular-nums">{value}</span>
                              </li>
                            ),
                          )}
                        </ul>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-1.5 flex" aria-hidden>
            <div className="shrink-0" style={{ width: AXIS_W }} />
            <div className={`flex min-w-0 flex-1 ${gap}`}>
              {columns.map((column) => (
                <p
                  key={column.key ?? column.label}
                  className="min-w-0 flex-1 truncate text-center text-[10px] text-[var(--fg-faint)]"
                >
                  {column.axis ?? column.label}
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* One band needs no legend: the section's own title already names what is plotted, and a
          lone swatch reading "Plays" under a chart of plays is furniture. Rendered conditionally
          rather than with `hidden`, which the `flex` utility would out-specify. */}
      {banded && (
        <ul className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {segments.map((name, band) => (
            <li
              key={name}
              className="flex items-center gap-1.5 text-[11px] text-[var(--fg-dim)]"
            >
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-[3px]"
                style={{ background: STEPS[band] }}
              />
              {name}
            </li>
          ))}
        </ul>
      )}

      <details className="group mt-4">
        <summary className="press inline-flex cursor-pointer list-none items-center gap-1.5 rounded-[var(--r-sm)] text-[length:var(--text-meta)] font-semibold text-[var(--fg-dim)] outline-none hover:text-[var(--fg)]">
          <span aria-hidden className="transition-transform group-open:rotate-90">
            &rsaquo;
          </span>
          Read the numbers
        </summary>

        <div className="mt-2 max-h-72 overflow-auto rounded-[var(--r-md)] bg-[var(--surface-2)] px-3 py-2">
          <table className="w-full text-left text-[length:var(--text-meta)] tabular-nums">
            {caption && <caption className="sr-only">{caption}</caption>}
            <thead>
              <tr className="border-b border-[var(--line)] text-[var(--fg-faint)]">
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  {rowLabel}
                </th>
                {banded &&
                  segments.map((name) => (
                    <th key={name} scope="col" className="py-1.5 pl-3 text-right font-semibold">
                      {name}
                    </th>
                  ))}
                <th scope="col" className="py-1.5 pl-3 text-right font-semibold">
                  {`${unit.charAt(0).toUpperCase()}${unit.slice(1)}s`}
                </th>
              </tr>
            </thead>
            <tbody>
              {columns.map((column) => (
                <tr key={column.key ?? column.label} className="border-b border-[var(--line)] last:border-0">
                  <th scope="row" className="py-1.5 pr-3 font-medium text-[var(--fg-dim)]">
                    {column.label}
                  </th>
                  {banded &&
                    column.values.map((value, band) => (
                      <td key={band} className="py-1.5 pl-3 text-right text-[var(--fg-dim)]">
                        {value}
                      </td>
                    ))}
                  <td className="py-1.5 pl-3 text-right font-semibold">{column.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
