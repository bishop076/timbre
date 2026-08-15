"use client";

import { useState } from "react";

// A stacked column chart: genre on the x-axis, split into rank bands. One hue in four steps
// rather than four colours, since rank bands are an ordered scale. Built from divs, not SVG,
// so labels inherit the theme's type scale and wrap normally.

/** Four steps of the accent, strongest first — reversed, it handed the full accent to
 * the 76–100 band. Mixed against the surface so the ramp follows the theme. */
const STEPS = [
  "var(--accent)",
  "color-mix(in oklab, var(--accent) 78%, var(--surface-2))",
  "color-mix(in oklab, var(--accent) 55%, var(--surface-2))",
  "color-mix(in oklab, var(--accent) 32%, var(--surface-2))",
];

/** Plot height and the value axis gutter. The two must agree to the pixel, so they
 * are siblings in one row of this height rather than two boxes with their own copy. */
const PLOT_H = 150;
const AXIS_W = 28;

export interface Column {
  label: string;
  total: number;
  /** One value per segment, in the same order as `segments`. */
  values: number[];
}

/** The chart, with a value tooltip on hover and a legend beneath. */
export function StackedColumns({
  columns,
  segments,
  unit,
}: {
  columns: Column[];
  /** Segment names, strongest step first — see `STEPS`. */
  segments: readonly string[];
  /** What a unit is, singular, for the tooltip. */
  unit: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (columns.length === 0) return null;

  const max = Math.max(...columns.map((column) => column.total), 1);
  const step = max <= 5 ? 1 : max <= 12 ? 2 : max <= 30 ? 5 : 10;
  // A tenth of headroom before rounding: 19 against a ceiling of 20 puts the rounded cap
  // on the top gridline, reading as if the column were escaping the card.
  const ceiling = Math.ceil((max * 1.1) / step) * step;
  const ticks = Array.from({ length: ceiling / step + 1 }, (_, index) => index * step);

  return (
    <div>
      {/*
        One row, so the layout stretches axis and plot to the same box — as separate
        boxes with equal heights they still disagreed and the zero line sat above the
        foot of the columns. The columns divide whatever width exists: as a scroll box
        around a `w-max` plot the chart ran off the edge of a phone. `pt-2` is for the
        topmost axis label, otherwise clipped to a half-height number.
      */}
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

              <div className="flex h-full items-end gap-1.5 sm:gap-2">
                {columns.map((column, index) => (
                  <div
                    key={column.label}
                    className="relative flex h-full min-w-0 flex-1 flex-col justify-end"
                    onPointerEnter={() => setHover(index)}
                    onPointerLeave={() => setHover(null)}
                  >
                    {column.values
                      .map((value, band) => ({ value, band }))
                      .reverse()
                      .map(({ value, band }) =>
                        value === 0 ? null : (
                          <div
                            key={band}
                            // A gap, not a border, which would add ink that is not data.
                            className="w-full first:rounded-t-[4px]"
                            style={{
                              height: `calc(${(value / ceiling) * 100}% - 2px)`,
                              marginBottom: 2,
                              background: STEPS[band],
                            }}
                          />
                        ),
                      )}

                    {/* `max-w` in viewport units on the tooltip: centred on a ~28px
                        column it hangs well outside it, and at a fixed 10rem the
                        first and last ran past the card on a phone. */}
                    {hover === index && (
                      <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 w-40 max-w-[60vw] -translate-x-1/2 rounded-[var(--r-md)] bg-[var(--surface-2)] px-2.5 py-2 shadow-[var(--drop-lg)]">
                        <p className="truncate text-[12px] font-semibold">{column.label}</p>
                        <p className="text-[11px] tabular-nums text-[var(--fg-dim)]">
                          {column.total} {column.total === 1 ? unit : `${unit}s`}
                        </p>
                        <ul className="mt-1 space-y-0.5">
                          {column.values.map((value, band) =>
                            value === 0 ? null : (
                              <li
                                key={band}
                                className="flex items-center gap-1.5 text-[10px] text-[var(--fg-faint)]"
                              >
                                <span
                                  aria-hidden
                                  className="size-2 shrink-0 rounded-[2px]"
                                  style={{ background: STEPS[band] }}
                                />
                                {segments[band]}
                                <span className="ml-auto tabular-nums">{value}</span>
                              </li>
                            ),
                          )}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-1.5 flex">
            <div className="shrink-0" style={{ width: AXIS_W }} aria-hidden />
            <div className="flex min-w-0 flex-1 gap-1.5 sm:gap-2">
              {columns.map((column) => (
                <p
                  key={column.label}
                  title={column.label}
                  className="min-w-0 flex-1 truncate text-center text-[10px] text-[var(--fg-faint)]"
                >
                  {column.label}
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Always present — colour alone is never the only way to tell segments apart. */}
      <ul className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {segments.map((name, band) => (
          <li key={name} className="flex items-center gap-1.5 text-[11px] text-[var(--fg-dim)]">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ background: STEPS[band] }}
            />
            {name}
          </li>
        ))}
      </ul>
    </div>
  );
}
