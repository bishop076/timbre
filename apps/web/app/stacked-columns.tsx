"use client";

import { useState } from "react";

/**
 * A stacked column chart.
 *
 * OpenRouter's rankings shape — columns of differing height, each split into
 * segments, a legend beneath, a value on hover. What it plots here is not the
 * same thing, and could not be: theirs is a year of weekly usage, drawn from
 * their own logs. Timbre logs nothing and no free source publishes chart
 * history, so the x-axis is genre rather than time. The form carries over; the
 * claim does not.
 *
 * **Segments take one hue in four steps, not four colours.** They are rank
 * bands — 1–25, 26–50 and so on — which is an *ordered* scale, and a rainbow
 * across it would say the bands are unrelated kinds when they are neighbours on
 * one ruler. The strongest step is the highest-placed band, so a column with a
 * bright mass at its foot reads as "this genre reaches the top of the chart".
 *
 * Built from divs rather than SVG. The columns are rectangles stacked in a
 * flex column and the labels are ordinary text, so they inherit the theme's
 * fonts and wrap like everything else — an SVG would need its own type scale
 * and would resize its text with the viewBox.
 */

/**
 * Four steps of the accent, strongest first.
 *
 * **Strongest first, because the first segment is the most important one.** The
 * ramp was the other way round to begin with, which handed the full accent to
 * the 76–100 band and left the top 25 as the faintest thing in the column — the
 * chart was shouting about its least significant entries. On an ordered scale
 * the emphasis has to run with the order.
 *
 * Mixed against the surface rather than hard-coded, so the ramp follows the
 * reader's chosen theme instead of being a fifth palette that only matches on
 * the default one.
 */
const STEPS = [
  "var(--accent)",
  "color-mix(in oklab, var(--accent) 78%, var(--surface-2))",
  "color-mix(in oklab, var(--accent) 55%, var(--surface-2))",
  "color-mix(in oklab, var(--accent) 32%, var(--surface-2))",
];

/**
 * Plot height in pixels, and the gutter the value axis sits in.
 *
 * The axis and the plot must agree to the pixel — the zero line and the foot of
 * every column are the same line — so they are siblings inside one row of this
 * height rather than two boxes each carrying their own copy of it.
 */
const PLOT_H = 150;
const AXIS_W = 28;

export interface Column {
  label: string;
  total: number;
  /** One value per segment, in the same order as `segments`. */
  values: number[];
}

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
  // Ticks on round numbers. A grid at 3.5 songs is a grid measuring nothing.
  const step = max <= 5 ? 1 : max <= 12 ? 2 : max <= 30 ? 5 : 10;
  /*
   * The top of the scale sits clear of the tallest column.
   *
   * Rounding the maximum up to the next tick is not enough on its own: 19 songs
   * against a ceiling of 20 leaves the column 95% of the way up, so its rounded
   * cap lands on the top gridline and reads as though it is escaping the card.
   * Taking a tenth of headroom first pushes the scale to the next tick up, which
   * is what every drawn axis does and why none of them look full.
   */
  const ceiling = Math.ceil((max * 1.1) / step) * step;
  const ticks = Array.from({ length: ceiling / step + 1 }, (_, index) => index * step);

  return (
    <div>
      {/*
        The axis and the plot are siblings of one row with a definite height.

        Both earlier attempts had them as separate boxes each given the same
        height, and they still disagreed — the zero line sat well above the foot
        of the columns. Making them children of one row means the layout itself
        stretches them to the same box, and there is no second number to drift.

        Fits the width it is given, rather than scrolling sideways inside it.

        This was a scroll box holding a `w-max` plot, so on a narrow screen the
        columns kept their intrinsic width and the chart ran off the edge —
        readable only by dragging, on a card that gave no sign it could be
        dragged. Letting the columns divide whatever width exists means the
        whole chart is always visible; the caller keeps the count low enough
        that they stay legible when it is small.

        `pt-2` is for the topmost axis label. It is positioned at `bottom: 100%`
        and pulled halfway back down, so it straddles the top edge — and the box
        clipped it, leaving a half-height number floating above the plot with no
        gridline of its own.
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
              {/* Solid hairlines one step off the surface. Dashes read as a
                  threshold when they are only a grid. */}
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
                    {/* Segments run top-down in the markup so the highest band
                        renders at the top of the column, which is where a reader
                        looks for "the best of this group". */}
                    {column.values
                      .map((value, band) => ({ value, band }))
                      .reverse()
                      .map(({ value, band }) =>
                        value === 0 ? null : (
                          <div
                            key={band}
                            // A 2px surface gap separates touching segments. A
                            // border would add ink that is not data and would
                            // darken every boundary.
                            className="w-full first:rounded-t-[4px]"
                            style={{
                              height: `calc(${(value / ceiling) * 100}% - 2px)`,
                              marginBottom: 2,
                              background: STEPS[band],
                            }}
                          />
                        ),
                      )}

                    {/* `max-w` in viewport units on the tooltip below: it is
                        centred on a column ~28px wide and so hangs well outside
                        it by design — at a fixed 10rem the ones over the first
                        and last columns ran past the card on a phone. */}
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

          {/* The same gutter, so a column name stays under its column. */}
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

      {/* Outside the scroll box: it names colours rather than lining up with
          anything, so it must not slide away when the columns are pushed. */}
      {/* A legend is always present for more than one series — colour alone is
          never the only way to tell segments apart. */}
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
